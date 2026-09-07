import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {File, Paths} from 'expo-file-system';
import {useUser} from '../account/UserContext';
import {datasetSource, requireDatasetCatalog, type DatasetDescriptor} from './datasetCatalog';
import {listLocalPackDescriptors, localDatasetSource, isLocalPackDescriptor, removeLocalPack} from './localPackStorage';
import {listDownloads, savedSource, PUBLIC_ORIGIN} from '../native/packLibrary.native';
import type {DatasetCatalogState} from './DatasetCatalogContext';
export type {DatasetCatalogState} from './DatasetCatalogContext';
interface CatalogValue {
  state: DatasetCatalogState;
  select(slug: string): void;
  refreshLocal(preferredSlug?: string): void;
  removeLocal(slug: string): Promise<void>;
}
const Context = createContext<CatalogValue | null>(null);
const snapshot = new File(Paths.document, 'published-catalog.json');
export function DatasetCatalogProvider({children}: {children: React.ReactNode}) {
  const account = useUser();
  const owner = account.user?.id ?? 'guest';
  const [revision, setRevision] = useState(0);
  const [preferred, setPreferred] = useState<string | null>(null);
  const [result, setResult] = useState<{owner: string; state: DatasetCatalogState}>({owner, state: {status: 'loading'}});
  const state: DatasetCatalogState = result.owner === owner ? result.state : {status: 'loading'};
  const selectionFile = useMemo(() => new File(Paths.document, `selected-pack-${owner}.txt`), [owner]);
  const sourceFor = useCallback((descriptor: DatasetDescriptor) => {
    if (isLocalPackDescriptor(descriptor)) return localDatasetSource(descriptor);
    return (account.user && savedSource(account.user.id, descriptor)) || datasetSource(descriptor, PUBLIC_ORIGIN);
  }, [account.user?.id]);
  useEffect(() => {
    if (account.status === 'loading') return;
    const controller = new AbortController();
    let alive = true;
    async function load() {
      let available: DatasetDescriptor[] = [];
      try {
        const locals = await listLocalPackDescriptors();
        const downloads = account.user ? listDownloads(account.user.id).map(entry => entry.descriptor) : [];
        const saved = [...locals, ...downloads];
        const requested = preferred ?? (selectionFile.exists ? selectionFile.textSync() : null);
        const apply = (published: DatasetDescriptor[]) => {
          available = [...saved, ...published.filter(entry => !saved.some(local => local.slug === entry.slug))];
          const selected = available.find(entry => entry.slug === requested) ?? saved[0] ?? available.find(entry => entry.isDefault) ?? available[0];
          if (!selected) throw new Error('No packs are available. Connect to load the catalog or import an exporter ZIP.');
          if (alive) setResult({owner, state: {status: 'ready', datasets: available, selected, source: sourceFor(selected)}});
        };
        if (snapshot.exists) apply(requireDatasetCatalog(JSON.parse(snapshot.textSync())));
        else if (saved.length) apply([]);
        // Show verified saved packs immediately, then refresh the public catalog.
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
          const response = await fetch(`${PUBLIC_ORIGIN}/api/datasets`, {signal: controller.signal});
          if (!response.ok) throw new Error(`Pack catalog returned HTTP ${response.status}.`);
          const body = await response.json();
          const published = requireDatasetCatalog(body);
          if (!alive) return;
          snapshot.write(JSON.stringify(body));
          apply(published);
        } catch (error) {
          if (!alive) return;
          console.warn('Public catalog refresh failed; showing the saved device catalog.', error);
          if (!available.length) throw error;
        } finally { clearTimeout(timeout); }
      } catch (error) {
        console.error('The iOS pack library could not be loaded.', error);
        if (alive) setResult({owner, state: {status: 'error', datasets: available, message: error instanceof Error ? error.message : 'Pack library unavailable.'}});
      }
    }
    void load();
    return () => { alive = false; controller.abort(); };
  }, [owner, account.status, revision, preferred, selectionFile, sourceFor]);
  const select = useCallback((slug: string) => {
    const datasets = state.status === 'loading' ? [] : state.datasets;
    const selected = datasets.find(entry => entry.slug === slug);
    if (!selected) throw new Error('The selected pack is not available.');
    selectionFile.write(slug);
    setPreferred(slug);
    setResult({owner, state: {status: 'ready', datasets, selected, source: sourceFor(selected)}});
  }, [state, owner, sourceFor, selectionFile]);
  const refreshLocal = useCallback((slug?: string) => { if (slug) setPreferred(slug); setRevision(value => value + 1); }, []);
  const removeLocal = useCallback(async (slug: string) => {
    if (!await removeLocalPack(slug)) throw new Error('The local pack could not be removed.');
    setPreferred(null); setRevision(value => value + 1);
  }, []);
  return <Context.Provider value={{state, select, refreshLocal, removeLocal}}>{children}</Context.Provider>;
}
export function useDatasetCatalog(): CatalogValue {
  const context = useContext(Context);
  if (!context) throw new Error('useDatasetCatalog requires DatasetCatalogProvider.');
  return context;
}
