import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Platform} from 'react-native';
import {
  type DatasetDescriptor,
  type DatasetSource,
  datasetSource,
  preserveDatasetMount,
  readRequestedDatasetSlug,
  requireDatasetCatalog,
  searchWithDatasetSlug,
  selectDataset,
} from './datasetCatalog';
import {
  LOCAL_PACK_CATALOG_CHANGED_EVENT,
  isLocalPackDescriptor,
  listLocalPackDescriptors,
  localDatasetSource,
  registerLocalPackServiceWorker,
  removeLocalPack as removeStoredLocalPack,
} from './localPackStorage';
import {loadPublishedDatasetCatalogOnce} from './publishedDatasetCatalog';

const PRODUCTION_ORIGIN = 'https://minecraftrecipetree.craftsmannsoftware.com';

interface DatasetRequestConfiguration {
  catalogUrl: string;
  assetOrigin: string;
}

export type DatasetCatalogState =
  | {status: 'loading'}
  | {status: 'error'; message: string; datasets: readonly DatasetDescriptor[]}
  | {
      status: 'ready';
      datasets: readonly DatasetDescriptor[];
      selected: DatasetDescriptor;
      source: DatasetSource;
    };

interface DatasetCatalogContextValue {
  state: DatasetCatalogState;
  select(slug: string): void;
  refreshLocal(preferredSlug?: string): void;
  removeLocal(slug: string): Promise<void>;
}

function absoluteHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error(`${label} must be an absolute HTTP(S) URL without credentials.`);
  }
  return url;
}

function requestConfiguration(): DatasetRequestConfiguration {
  const configuredCatalog = process.env.EXPO_PUBLIC_DATASET_CATALOG_URL;
  const configuredOrigin = process.env.EXPO_PUBLIC_DATASET_ORIGIN;

  if (Platform.OS === 'web') {
    if (!configuredCatalog) {
      if (configuredOrigin) {
        throw new Error(
          'EXPO_PUBLIC_DATASET_ORIGIN cannot be set without EXPO_PUBLIC_DATASET_CATALOG_URL on web.',
        );
      }
      return {catalogUrl: '/api/datasets', assetOrigin: ''};
    }
    if (configuredCatalog.startsWith('/')) {
      if (configuredCatalog.startsWith('//')) {
        throw new Error('EXPO_PUBLIC_DATASET_CATALOG_URL cannot be protocol-relative.');
      }
      return {catalogUrl: configuredCatalog, assetOrigin: configuredOrigin ?? ''};
    }
    const catalog = absoluteHttpUrl(configuredCatalog, 'EXPO_PUBLIC_DATASET_CATALOG_URL');
    return {
      catalogUrl: catalog.href,
      assetOrigin: configuredOrigin ?? catalog.origin,
    };
  }

  // Native clients have no same-origin Worker. They use the public catalog by default, while
  // development deployments can point both catalog and immutable asset routes at another host.
  const catalog = absoluteHttpUrl(
    configuredCatalog ?? `${PRODUCTION_ORIGIN}/api/datasets`,
    'EXPO_PUBLIC_DATASET_CATALOG_URL',
  );
  return {
    catalogUrl: catalog.href,
    assetOrigin: configuredOrigin ?? catalog.origin,
  };
}

function currentWebRequestSlug(): string | null {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined') {
    throw new Error('The web dataset catalog cannot read the pack query before window is available.');
  }
  return readRequestedDatasetSlug(window.location.search);
}

function writeWebRequestSlug(slug: string): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') {
    throw new Error('The web dataset selector cannot update the pack query without window.');
  }
  const nextSearch = searchWithDatasetSlug(window.location.search, slug);
  const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
  window.history.pushState(window.history.state, '', nextUrl);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DatasetCatalogContext = createContext<DatasetCatalogContextValue | null>(null);

export function DatasetCatalogProvider({children}: {children: React.ReactNode}) {
  const [datasets, setDatasets] = useState<readonly DatasetDescriptor[]>([]);
  const [selected, setSelected] = useState<DatasetDescriptor | null>(null);
  const [assetOrigin, setAssetOrigin] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localCatalogRevision, setLocalCatalogRevision] = useState(0);
  const selectedSlugRef = useRef<string | null>(null);
  const localPublicationIdsRef = useRef(new Set<string>());
  const preferredLocalSlugRef = useRef<string | null>(null);
  const publishedDatasetsRef = useRef<readonly DatasetDescriptor[] | null>(null);

  const sourceFor = useCallback(
    (descriptor: DatasetDescriptor, origin: string): DatasetSource =>
      localPublicationIdsRef.current.has(descriptor.publicationId)
        ? localDatasetSource(descriptor)
        : datasetSource(descriptor, origin),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      try {
        const configuration = requestConfiguration();
        const serviceWorkerReady = registerLocalPackServiceWorker().catch(workerError => {
          console.warn(
            'Packed-image caching and saved pack file loading are unavailable on this device.',
            workerError,
          );
        });
        const publishedDatasets = await loadPublishedDatasetCatalogOnce(
          publishedDatasetsRef,
          async () => {
            const response = await fetch(configuration.catalogUrl, {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(
                `Dataset catalog request failed with HTTP ${response.status} at ${configuration.catalogUrl}.`,
              );
            }
            let value: unknown;
            try {
              value = await response.json();
            } catch (cause) {
              throw new Error(`Dataset catalog returned invalid JSON: ${errorMessage(cause)}`);
            }
            return requireDatasetCatalog(value);
          },
        );
        const defaultDataset = selectDataset(publishedDatasets, null);
        sourceFor(defaultDataset, configuration.assetOrigin);
        const requestedSlug = preferredLocalSlugRef.current ?? currentWebRequestSlug();
        let publishedSelection = defaultDataset;
        try {
          publishedSelection = selectDataset(publishedDatasets, requestedSlug);
        } catch (selectionError) {
          // A saved local pack is discovered asynchronously below. Show the published catalog
          // immediately while its service worker and browser cache finish initializing.
          if (!requestedSlug?.startsWith('local-')) throw selectionError;
        }
        // A first-time browser must be controlled before data-backed views mount. Otherwise a
        // large tree can issue one Worker request per image while the service worker activates.
        await serviceWorkerReady;
        if (!alive) return;
        if (!requestedSlug?.startsWith('local-')) {
          setDatasets(publishedDatasets);
          setAssetOrigin(configuration.assetOrigin);
          selectedSlugRef.current = publishedSelection.slug;
          setSelected(current => preserveDatasetMount(current, publishedSelection));
          setError(null);
          setLoading(false);
        }

        let localDatasets: readonly DatasetDescriptor[] = [];
        try {
          localDatasets = await listLocalPackDescriptors();
        } catch (localError) {
          console.warn('The saved pack list is unavailable on this device.', localError);
        }
        const publishedSlugs = new Set(publishedDatasets.map(dataset => dataset.slug));
        localDatasets = localDatasets.filter(dataset => !publishedSlugs.has(dataset.slug));
        localPublicationIdsRef.current = new Set(
          localDatasets.map(dataset => dataset.publicationId),
        );
        const nextDatasets = [...localDatasets, ...publishedDatasets];
        if (!alive) return;
        setDatasets(nextDatasets);
        setAssetOrigin(configuration.assetOrigin);
        const nextSelected = selectDataset(
          nextDatasets,
          preferredLocalSlugRef.current ?? currentWebRequestSlug(),
        );
        sourceFor(nextSelected, configuration.assetOrigin);
        if (!alive) return;
        selectedSlugRef.current = nextSelected.slug;
        preferredLocalSlugRef.current = null;
        setSelected(current => preserveDatasetMount(current, nextSelected));
        setError(null);
        setLoading(false);
      } catch (cause) {
        if (!alive || controller.signal.aborted) return;
        const message = errorMessage(cause);
        console.error('Dataset catalog initialization failed.', cause);
        setError(message);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [localCatalogRevision, sourceFor]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const refreshLocalCatalog = () => {
      setLocalCatalogRevision(revision => revision + 1);
    };
    window.addEventListener(LOCAL_PACK_CATALOG_CHANGED_EVENT, refreshLocalCatalog);
    window.addEventListener('pageshow', refreshLocalCatalog);
    window.addEventListener('focus', refreshLocalCatalog);
    return () => {
      window.removeEventListener(LOCAL_PACK_CATALOG_CHANGED_EVENT, refreshLocalCatalog);
      window.removeEventListener('pageshow', refreshLocalCatalog);
      window.removeEventListener('focus', refreshLocalCatalog);
    };
  }, []);

  const refreshLocal = useCallback((preferredSlug?: string) => {
    preferredLocalSlugRef.current = preferredSlug ?? null;
    setLocalCatalogRevision(revision => revision + 1);
  }, []);

  const select = useCallback(
    (slug: string) => {
      try {
        if (datasets.length === 0) {
          throw new Error('Dataset selection was requested before a valid catalog was loaded.');
        }
        const nextSelected = selectDataset(datasets, slug);
        sourceFor(nextSelected, assetOrigin);
        if (selectedSlugRef.current === nextSelected.slug) {
          setError(null);
          return;
        }
        writeWebRequestSlug(nextSelected.slug);
        selectedSlugRef.current = nextSelected.slug;
        setSelected(nextSelected);
        setError(null);
      } catch (cause) {
        const message = errorMessage(cause);
        console.error('Dataset selection failed.', {slug, cause});
        selectedSlugRef.current = null;
        setSelected(null);
        setError(message);
      }
    },
    [assetOrigin, datasets, sourceFor],
  );

  const removeLocal = useCallback(
    async (slug: string) => {
      const descriptor = datasets.find(dataset => dataset.slug === slug);
      if (!descriptor || !isLocalPackDescriptor(descriptor)) {
        throw new Error('Only a saved local pack can be deleted.');
      }

      const remaining = datasets.filter(dataset => dataset.slug !== slug);
      const deletingSelection = selectedSlugRef.current === slug;
      const fallback = deletingSelection ? selectDataset(remaining, null) : null;
      if (fallback) writeWebRequestSlug(fallback.slug);

      const removed = await removeStoredLocalPack(slug);
      if (!removed) {
        throw new Error(`${descriptor.displayName} is no longer saved on this device.`);
      }

      localPublicationIdsRef.current.delete(descriptor.publicationId);
      setDatasets(remaining);
      if (fallback) {
        sourceFor(fallback, assetOrigin);
        selectedSlugRef.current = fallback.slug;
        setSelected(fallback);
      }
      setError(null);
    },
    [assetOrigin, datasets, sourceFor],
  );

  useEffect(() => {
    if (Platform.OS !== 'web' || datasets.length === 0) return;
    const handlePopState = () => {
      try {
        const nextSelected = selectDataset(datasets, currentWebRequestSlug());
        sourceFor(nextSelected, assetOrigin);
        selectedSlugRef.current = nextSelected.slug;
        setSelected(nextSelected);
        setError(null);
      } catch (cause) {
        const message = errorMessage(cause);
        console.error('Browser history selected an invalid dataset.', cause);
        selectedSlugRef.current = null;
        setSelected(null);
        setError(message);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [assetOrigin, datasets, sourceFor]);

  const state = useMemo<DatasetCatalogState>(() => {
    if (loading) return {status: 'loading'};
    if (error || !selected) {
      return {
        status: 'error',
        message: error ?? 'Dataset selection is unavailable.',
        datasets,
      };
    }
    return {
      status: 'ready',
      datasets,
      selected,
      source: sourceFor(selected, assetOrigin),
    };
  }, [assetOrigin, datasets, error, loading, selected, sourceFor]);

  const value = useMemo<DatasetCatalogContextValue>(
    () => ({state, select, refreshLocal, removeLocal}),
    [refreshLocal, removeLocal, select, state],
  );
  return <DatasetCatalogContext.Provider value={value}>{children}</DatasetCatalogContext.Provider>;
}

export function useDatasetCatalog(): DatasetCatalogContextValue {
  const value = useContext(DatasetCatalogContext);
  if (!value) throw new Error('useDatasetCatalog must be rendered inside DatasetCatalogProvider.');
  return value;
}
