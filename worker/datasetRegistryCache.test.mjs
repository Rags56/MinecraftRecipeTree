import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DATASET_CATALOG_EDGE_TTL_SECONDS,
  handleDatasetCatalog,
} from './datasetRegistry.ts';

const PUBLICATION = 'a'.repeat(64);
const PREVIEW = 'b'.repeat(64);
const ROW = Object.freeze({
  slug: 'meatballcraft',
  display_name: 'MeatballCraft',
  minecraft_version: '1.12.2',
  pack_version: '0.18.6.4',
  publication_id: PUBLICATION,
  preview_asset_set_id: PREVIEW,
  is_default: 1,
});

class CatalogD1 {
  reads = 0;

  prepare(sql) {
    const database = this;
    return {
      bind() { return this; },
      async all() {
        assert.match(sql, /FROM dataset_channels/);
        database.reads += 1;
        return {success: true, results: [ROW]};
      },
      async first() { return null; },
      async run() { return {success: true}; },
    };
  }

  async batch(statements) {
    return statements.map(() => ({success: true}));
  }
}

class MemoryCache {
  entries = new Map();
  puts = [];

  async match(request) {
    return this.entries.get(request.url)?.clone();
  }

  async put(request, response) {
    this.puts.push({request, response: response.clone()});
    this.entries.set(request.url, response.clone());
  }

  async delete(request) {
    return this.entries.delete(request.url);
  }
}

function replaceCache(value) {
  const previous = globalThis.caches;
  globalThis.caches = value;
  return () => { globalThis.caches = previous; };
}

test('catalog caches one query-string-free edge response while callers retain no-store', async t => {
  const cache = new MemoryCache();
  const restore = replaceCache({default: cache});
  t.after(restore);
  const db = new CatalogD1();
  const first = await handleDatasetCatalog(
    new Request('https://viewer.example/api/datasets?first=1'),
    {DB: db},
  );
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(db.reads, 1);
  assert.equal(cache.puts.length, 1);
  assert.equal(cache.puts[0].request.url, 'https://viewer.example/api/datasets');
  assert.equal(
    cache.puts[0].response.headers.get('cache-control'),
    `public, max-age=${DATASET_CATALOG_EDGE_TTL_SECONDS}`,
  );

  const second = await handleDatasetCatalog(
    new Request('https://viewer.example/api/datasets?second=2'),
    {DB: db},
  );
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('cache-control'), 'no-store');
  assert.equal(db.reads, 1, 'an edge hit must not read D1 again');
  assert.deepEqual(await second.json(), {datasets: [{
    slug: 'meatballcraft',
    displayName: 'MeatballCraft',
    minecraftVersion: '1.12.2',
    packVersion: '0.18.6.4',
    publicationId: PUBLICATION,
    previewAssetSetId: PREVIEW,
    isDefault: true,
  }]});
});

test('catalog logs unavailable cache access and returns a fresh D1 response', async t => {
  const restore = replaceCache(new Proxy({}, {
    get() { throw new Error('cache unavailable'); },
  }));
  t.after(restore);
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...values) => warnings.push(values);
  t.after(() => { console.warn = previousWarn; });
  const db = new CatalogD1();
  const response = await handleDatasetCatalog(
    new Request('https://viewer.example/api/datasets'),
    {DB: db},
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(db.reads, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /cache is unavailable/i);
});

test('catalog logs a cache fill failure without discarding the valid D1 result', async t => {
  const restore = replaceCache({
    default: {
      async match() { return undefined; },
      async put() { throw new Error('fill failed'); },
      async delete() { return false; },
    },
  });
  t.after(restore);
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...values) => warnings.push(values);
  t.after(() => { console.warn = previousWarn; });
  const db = new CatalogD1();
  const response = await handleDatasetCatalog(
    new Request('https://viewer.example/api/datasets'),
    {DB: db},
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(db.reads, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /cache fill failed/i);
});

test('catalog logs a cache lookup failure, reads D1, and repairs the edge entry', async t => {
  let puts = 0;
  const restore = replaceCache({
    default: {
      async match() { throw new Error('lookup failed'); },
      async put() { puts += 1; },
      async delete() { return false; },
    },
  });
  t.after(restore);
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...values) => warnings.push(values);
  t.after(() => { console.warn = previousWarn; });
  const db = new CatalogD1();
  const response = await handleDatasetCatalog(
    new Request('https://viewer.example/api/datasets'),
    {DB: db},
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(db.reads, 1);
  assert.equal(puts, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /cache lookup failed/i);
});
