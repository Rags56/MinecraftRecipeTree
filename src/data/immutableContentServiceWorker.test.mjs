import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const ORIGIN = 'https://viewer.example';
const PUBLICATION = 'a'.repeat(64);

async function serviceWorkerHarness({networkResponses, failCachePut = false} = {}) {
  const source = await readFile(new URL('../../public/local-pack-sw.js', import.meta.url), 'utf8');
  const listeners = new Map();
  const errors = [];
  let networkRequests = 0;
  const cachesByName = new Map();
  function cacheFor(name) {
    let entries = cachesByName.get(name);
    if (!entries) {
      entries = new Map();
      cachesByName.set(name, entries);
    }
    return {
      async delete(request) {
        return entries.delete(typeof request === 'string' ? request : request.url);
      },
      async keys() {
        return [...entries.keys()].map(url => new Request(url));
      },
      async match(request) {
        return entries.get(typeof request === 'string' ? request : request.url)?.clone();
      },
      async put(request, response) {
        if (failCachePut) throw new Error('The cache storage quota was exceeded.');
        entries.set(typeof request === 'string' ? request : request.url, response.clone());
      },
    };
  }
  const worker = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: {async claim() {}},
    location: {origin: ORIGIN},
    skipWaiting() {},
  };
  vm.runInNewContext(source, {
    Map,
    Number,
    Promise,
    Request,
    Response,
    URL,
    Uint8Array,
    caches: {async open(name) { return cacheFor(name); }},
    console: {
      error(...values) { errors.push(values); },
    },
    fetch: async request => {
      networkRequests += 1;
      const url = typeof request === 'string' ? request : request.url;
      const respond = networkResponses?.(url);
      if (respond) return respond;
      return new Response('payload', {
        status: 200,
        headers: {'Content-Length': '7', 'Content-Type': 'text/plain'},
      });
    },
    self: worker,
  });

  async function dispatch(path) {
    let response;
    listeners.get('fetch')({
      request: new Request(`${ORIGIN}${path}`),
      respondWith(value) { response = Promise.resolve(value); },
    });
    return response;
  }

  return {
    dispatch,
    errors,
    cacheSize: name => cachesByName.get(name)?.size ?? 0,
    networkRequests: () => networkRequests,
  };
}

test('app bundle chunks are cached and served without a repeat network request', async () => {
  const harness = await serviceWorkerHarness();
  const first = await harness.dispatch('/assets/App-abc123.js');
  assert.equal(await first.text(), 'payload');
  assert.equal(harness.networkRequests(), 1);

  const second = await harness.dispatch('/assets/App-abc123.js');
  assert.equal(await second.text(), 'payload');
  assert.equal(harness.networkRequests(), 1);
  assert.equal(harness.cacheSize('minecraft-recipe-tree-immutable-content-v1'), 1);
  assert.equal(harness.errors.length, 0);
});

test('dataset export documents are cached, but sprite coordinates and packed binaries are not', async () => {
  const harness = await serviceWorkerHarness();
  const manifestPath = `/dataset/publications/${PUBLICATION}/exports/manifest.json?dataset=${PUBLICATION}`;
  await harness.dispatch(manifestPath);
  await harness.dispatch(manifestPath);
  assert.equal(harness.networkRequests(), 1);
  assert.equal(harness.cacheSize('minecraft-recipe-tree-immutable-content-v1'), 1);

  // The sprite coordinate is handled entirely by the pre-existing packed-image path (asserted by
  // hostedImagePackServiceWorker.test.mjs); this only confirms it never touches this new cache.
  const spritePath =
    `/dataset/publications/${PUBLICATION}/exports/assets/s/000-0-4.webp?dataset=${PUBLICATION}`;
  const binPath = `/dataset/publications/${PUBLICATION}/exports/assets/pack-000.bin?dataset=${PUBLICATION}`;
  assert.ok(await harness.dispatch(spritePath));
  assert.equal(await harness.dispatch(binPath), undefined);
  assert.equal(harness.cacheSize('minecraft-recipe-tree-immutable-content-v1'), 1);
});

test('a byte budget over the limit prunes the oldest entries first', async () => {
  const harness = await serviceWorkerHarness({
    networkResponses: () =>
      new Response('x'.repeat(60 * 1024 * 1024), {
        status: 200,
        headers: {'Content-Length': String(60 * 1024 * 1024), 'Content-Type': 'text/plain'},
      }),
  });
  await harness.dispatch('/assets/one-aaa.js');
  await harness.dispatch('/assets/two-bbb.js');
  assert.equal(harness.cacheSize('minecraft-recipe-tree-immutable-content-v1'), 1);

  const stillFresh = await harness.dispatch('/assets/two-bbb.js');
  assert.equal((await stillFresh.text()).length, 60 * 1024 * 1024);
  assert.equal(harness.networkRequests(), 2);
});

test('a cache write failure still serves the network response', async () => {
  const harness = await serviceWorkerHarness({failCachePut: true});
  const response = await harness.dispatch('/assets/App-abc123.js');
  assert.equal(await response.text(), 'payload');
  assert.equal(harness.cacheSize('minecraft-recipe-tree-immutable-content-v1'), 0);
  assert.equal(harness.errors.length, 1);
});
