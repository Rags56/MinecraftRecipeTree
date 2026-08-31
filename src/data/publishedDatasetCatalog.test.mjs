import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPublishedDatasetCatalogOnce} from './publishedDatasetCatalog.ts';

const DATASETS = Object.freeze([
  Object.freeze({slug: 'published-pack', publicationId: 'publication-1'}),
]);

test('focus-driven local rescans reuse the resolved published catalog', async () => {
  const cache = {current: null};
  let requests = 0;
  const load = async () => {
    requests += 1;
    return DATASETS;
  };

  assert.equal(await loadPublishedDatasetCatalogOnce(cache, load), DATASETS);
  // A focus/pageshow/local-pack event reruns the local scan through the same provider cache.
  assert.equal(await loadPublishedDatasetCatalogOnce(cache, load), DATASETS);
  assert.equal(requests, 1);
});

test('a failed published catalog request is explicit and remains retryable', async () => {
  const cache = {current: null};
  let requests = 0;

  await assert.rejects(
    loadPublishedDatasetCatalogOnce(cache, async () => {
      requests += 1;
      throw new Error('catalog unavailable');
    }),
    /catalog unavailable/,
  );
  assert.equal(cache.current, null);

  assert.equal(
    await loadPublishedDatasetCatalogOnce(cache, async () => {
      requests += 1;
      return DATASETS;
    }),
    DATASETS,
  );
  assert.equal(requests, 2);
});
