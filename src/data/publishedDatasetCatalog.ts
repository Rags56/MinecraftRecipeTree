import type {DatasetDescriptor} from './datasetCatalog';

export interface PublishedDatasetCatalogCache {
  current: readonly DatasetDescriptor[] | null;
}

/**
 * Keeps published data stable while focus and pageshow events rescan browser-local packs.
 * Failed requests are never cached, so the next explicit refresh can retry and report its error.
 */
export async function loadPublishedDatasetCatalogOnce(
  cache: PublishedDatasetCatalogCache,
  load: () => Promise<readonly DatasetDescriptor[]>,
): Promise<readonly DatasetDescriptor[]> {
  if (cache.current) return cache.current;
  const publishedDatasets = await load();
  cache.current = publishedDatasets;
  return publishedDatasets;
}
