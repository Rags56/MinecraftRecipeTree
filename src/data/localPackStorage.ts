import {Unzip, UnzipInflate} from 'fflate';
import {readLocalFileSlice} from './localFileReader.ts';
import type {DatasetDescriptor, DatasetSource} from './datasetCatalog.ts';
import {
  MAX_EXPORT_ARCHIVE_ENTRIES,
  isIgnoredArchiveMetadataPath,
  localPackVersionLabel,
  requireSafeArchivePath,
  type LocalPackManifestSummary,
} from './localPackArchive.ts';
import type {LocalPackDelta, LocalPackDeltaFile} from './localPackDelta.ts';
import type {LocalPackArchiveFile} from './localPackInspection.ts';

const LOCAL_PACK_CACHE = 'minecraft-recipe-tree-local-packs-v1';
const LOCAL_PACK_CATALOG_PATH = '/__local-packs/catalog.json';
const LOCAL_PACK_ROUTE_PREFIX = '/__local-packs/';
const LOCAL_PACK_INVENTORY_NAME = 'inventory.json';
const ARCHIVE_READ_CHUNK_BYTES = 1024 * 1024;
const CACHE_DELETE_BATCH_SIZE = 32;
const CACHE_WRITE_CONCURRENCY = 4;
const CACHE_WRITE_BACKLOG = 128;
const MAX_LOCAL_PACKS = 24;
const MAX_LOCAL_FILE_BYTES = 128 * 1024 * 1024;
const LOCAL_CATALOG_FORMAT = 1;
const LOCAL_INVENTORY_FORMAT = 1;
const VIEWER_SERVICE_WORKER_URL = '/local-pack-sw.js?v=packed-images-and-shell-v1';
export const LOCAL_PACK_CATALOG_CHANGED_EVENT = 'mrt:local-pack-catalog-changed';

interface LocalPackRecord extends DatasetDescriptor {
  storedAt: number;
}

interface LocalPackCatalog {
  format: typeof LOCAL_CATALOG_FORMAT;
  packs: LocalPackRecord[];
}

interface LocalPackInventory {
  format: typeof LOCAL_INVENTORY_FORMAT;
  paths: string[];
}

export interface InstalledLocalPack {
  descriptor: DatasetDescriptor;
  viewerHref: string;
}

export type LocalPackInstallProgress =
  | {
      phase: 'reading';
      fraction: number;
      completedBytes: number;
      totalBytes: number;
      discoveredFiles: number;
    }
  | {phase: 'saving'; fraction: number; completedFiles: number; totalFiles: number}
  | {phase: 'finalizing'};

export function isLocalPackDescriptor(descriptor: DatasetDescriptor): boolean {
  return (
    /^local-[a-f0-9]{16}$/u.test(descriptor.slug) &&
    descriptor.previewAssetSetId === descriptor.publicationId
  );
}

function browserOrigin(): string {
  if (typeof window === 'undefined') {
    throw new Error('Local packs are only available in a web browser.');
  }
  return window.location.origin;
}

function cacheApi(): CacheStorage {
  if (typeof caches === 'undefined') {
    throw new Error('This browser cannot keep the pack for the viewer.');
  }
  return caches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isLocalPackRecord(value: unknown): value is LocalPackRecord {
  return (
    isRecord(value) &&
    typeof value.slug === 'string' &&
    /^local-[a-f0-9]{16}$/u.test(value.slug) &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    typeof value.minecraftVersion === 'string' &&
    value.minecraftVersion.length > 0 &&
    typeof value.packVersion === 'string' &&
    value.packVersion.length > 0 &&
    typeof value.publicationId === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.publicationId) &&
    value.previewAssetSetId === value.publicationId &&
    value.isDefault === false &&
    typeof value.storedAt === 'number' &&
    Number.isSafeInteger(value.storedAt) &&
    value.storedAt > 0
  );
}

function requireLocalPackCatalog(value: unknown): LocalPackCatalog {
  if (
    !isRecord(value) ||
    value.format !== LOCAL_CATALOG_FORMAT ||
    !Array.isArray(value.packs) ||
    value.packs.length > MAX_LOCAL_PACKS ||
    !value.packs.every(isLocalPackRecord)
  ) {
    throw new Error('The saved pack list is unreadable.');
  }
  return {
    format: LOCAL_CATALOG_FORMAT,
    packs: value.packs,
  };
}

function emptyCatalog(): LocalPackCatalog {
  return {format: LOCAL_CATALOG_FORMAT, packs: []};
}

function catalogRequest(): Request {
  return new Request(`${browserOrigin()}${LOCAL_PACK_CATALOG_PATH}`);
}

function notifyLocalPackCatalogChanged(): void {
  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function' &&
    typeof Event === 'function'
  ) {
    window.dispatchEvent(new Event(LOCAL_PACK_CATALOG_CHANGED_EVENT));
  }
}

async function readCatalog(cache: Cache): Promise<LocalPackCatalog> {
  const response = await cache.match(catalogRequest());
  if (!response) return emptyCatalog();
  try {
    return requireLocalPackCatalog(await response.json());
  } catch (error) {
    console.error('The local modpack list could not be read.', error);
    return emptyCatalog();
  }
}

async function writeCatalog(cache: Cache, catalog: LocalPackCatalog): Promise<void> {
  await cache.put(
    catalogRequest(),
    new Response(JSON.stringify(catalog), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    }),
  );
  notifyLocalPackCatalogChanged();
}

function localPackPath(publicationId: string, relativePath: string): string {
  return `${LOCAL_PACK_ROUTE_PREFIX}${publicationId}/exports/${relativePath}`;
}

function localPackRequest(publicationId: string, relativePath: string): Request {
  return new Request(`${browserOrigin()}${localPackPath(publicationId, relativePath)}`);
}

function inventoryRequest(publicationId: string): Request {
  return new Request(
    `${browserOrigin()}${LOCAL_PACK_ROUTE_PREFIX}${publicationId}/${LOCAL_PACK_INVENTORY_NAME}`,
  );
}

function contentType(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.json')) return 'application/json; charset=utf-8';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function rootPrefix(manifestPath: string): string {
  const separator = manifestPath.indexOf('/');
  return separator === -1 ? '' : manifestPath.slice(0, separator + 1);
}

function relativeExportPath(path: string, prefix: string): string | null {
  if (prefix === '') return path;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256ForBytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser cannot identify the pack safely.');
  }
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', digestInput.buffer)));
}

async function publicationIdForManifest(manifestBytes: Uint8Array): Promise<string> {
  return sha256ForBytes(manifestBytes);
}

function requireLocalPackInventory(value: unknown): LocalPackInventory {
  if (
    !isRecord(value) ||
    value.format !== LOCAL_INVENTORY_FORMAT ||
    !Array.isArray(value.paths) ||
    value.paths.length > MAX_EXPORT_ARCHIVE_ENTRIES ||
    !value.paths.every(
      path => typeof path === 'string' && requireSafeArchivePath(path) === path,
    )
  ) {
    throw new Error('The saved pack file list is unreadable.');
  }
  return {
    format: LOCAL_INVENTORY_FORMAT,
    paths: [...new Set(value.paths)],
  };
}

async function readPublicationInventory(
  cache: Cache,
  publicationId: string,
): Promise<readonly string[] | null> {
  const response = await cache.match(inventoryRequest(publicationId));
  if (!response) return null;
  try {
    return requireLocalPackInventory(await response.json()).paths;
  } catch (error) {
    console.error('A local pack file list could not be read.', error);
    return null;
  }
}

async function writePublicationInventory(
  cache: Cache,
  publicationId: string,
  paths: Iterable<string>,
): Promise<void> {
  const inventory: LocalPackInventory = {
    format: LOCAL_INVENTORY_FORMAT,
    paths: [...new Set(paths)].sort(),
  };
  await cache.put(
    inventoryRequest(publicationId),
    new Response(JSON.stringify(inventory), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    }),
  );
}

async function deletePublicationPaths(
  cache: Cache,
  publicationId: string,
  paths: readonly string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += CACHE_DELETE_BATCH_SIZE) {
    await Promise.all(
      paths
        .slice(offset, offset + CACHE_DELETE_BATCH_SIZE)
        .map(path => cache.delete(localPackRequest(publicationId, path))),
    );
  }
}

async function deletePublication(
  cache: Cache,
  publicationId: string,
  knownPaths?: Iterable<string>,
): Promise<void> {
  const paths = knownPaths
    ? [...new Set(knownPaths)]
    : await readPublicationInventory(cache, publicationId);
  if (paths === null) {
    console.warn(
      `The legacy local pack ${publicationId} has no file inventory; its unreferenced cache files were left in place.`,
    );
    return;
  }
  await deletePublicationPaths(cache, publicationId, paths);
  await cache.delete(inventoryRequest(publicationId));
}

export async function registerLocalPackServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('This browser cannot open saved packs in the viewer.');
  }
  let timeout = 0;
  let onControllerChange: (() => void) | null = null;
  try {
    await Promise.race([
      (async () => {
        await navigator.serviceWorker.register(VIEWER_SERVICE_WORKER_URL, {scope: '/'});
        await navigator.serviceWorker.ready;
        const expectedScriptUrl = new URL(VIEWER_SERVICE_WORKER_URL, window.location.origin).href;
        if (navigator.serviceWorker.controller?.scriptURL === expectedScriptUrl) return;
        await new Promise<void>(resolve => {
          onControllerChange = () => {
            if (navigator.serviceWorker.controller?.scriptURL === expectedScriptUrl) {
              resolve();
            }
          };
          navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
        });
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error('The viewer could not finish preparing its image cache.')),
          5_000,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
    if (onControllerChange) {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    }
  }
}

export async function listLocalPackDescriptors(): Promise<readonly DatasetDescriptor[]> {
  if (typeof window === 'undefined' || typeof caches === 'undefined') return [];
  const cache = await cacheApi().open(LOCAL_PACK_CACHE);
  const catalog = await readCatalog(cache);
  return [...catalog.packs]
    .sort((left, right) => right.storedAt - left.storedAt)
    .map(({storedAt: _storedAt, ...descriptor}) => descriptor);
}

export async function removeLocalPack(slug: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof caches === 'undefined') {
    throw new Error('Saved packs can only be deleted in a web browser.');
  }
  if (!/^local-[a-f0-9]{16}$/u.test(slug)) {
    throw new Error('Only a saved local pack can be deleted.');
  }

  const cache = await cacheApi().open(LOCAL_PACK_CACHE);
  const catalog = await readCatalog(cache);
  const record = catalog.packs.find(pack => pack.slug === slug);
  if (!record) return false;

  await writeCatalog(cache, {
    format: LOCAL_CATALOG_FORMAT,
    packs: catalog.packs.filter(pack => pack.slug !== slug),
  });
  try {
    await deletePublication(cache, record.publicationId);
  } catch (error) {
    // The catalog is the source of truth. Keep the removed pack hidden even if the browser
    // refuses a best-effort cleanup of one of its now-unreferenced cached files.
    console.error('Some cached files for the deleted local pack could not be removed.', {
      slug,
      publicationId: record.publicationId,
      error,
    });
  }
  return true;
}

export function localDatasetSource(descriptor: DatasetDescriptor): DatasetSource {
  return {
    descriptor,
    base: localPackPath(descriptor.publicationId, '').replace(/\/$/u, ''),
    previewBase: '',
  };
}

export async function installLocalPackArchive(
  file: LocalPackArchiveFile,
  manifestPath: string,
  manifestBytes: Uint8Array,
  manifest: unknown,
  summary: LocalPackManifestSummary,
  onProgress: (progress: LocalPackInstallProgress) => void,
  delta: LocalPackDelta | null = null,
): Promise<InstalledLocalPack> {
  await registerLocalPackServiceWorker();
  const publicationId = await publicationIdForManifest(manifestBytes);
  const descriptor: DatasetDescriptor = {
    slug: `local-${publicationId.slice(0, 16)}`,
    displayName: summary.packName,
    minecraftVersion: summary.minecraftVersion,
    packVersion: localPackVersionLabel(summary.packVersion),
    publicationId,
    previewAssetSetId: publicationId,
    isDefault: false,
  };
  const prefix = rootPrefix(manifestPath);
  const cache = await cacheApi().open(LOCAL_PACK_CACHE);
  const initialCatalog = await readCatalog(cache);
  const alreadyInstalled = initialCatalog.packs.find(
    pack => pack.publicationId === publicationId,
  );
  if (alreadyInstalled) {
    notifyLocalPackCatalogChanged();
    return {
      descriptor,
      viewerHref: `/?pack=${encodeURIComponent(descriptor.slug)}`,
    };
  }
  if (delta !== null && delta.resultPublicationId !== publicationId) {
    throw new Error('The update ZIP result does not match its manifest.');
  }
  const deltaBase = delta === null
    ? null
    : initialCatalog.packs.find(pack => pack.publicationId === delta.basePublicationId) ?? null;
  if (delta !== null && deltaBase === null) {
    throw new Error(
      `Install the full ${delta.packName} export before adding this update ZIP.`,
    );
  }
  if (
    delta !== null &&
    deltaBase !== null &&
    (deltaBase.displayName !== delta.packName ||
      deltaBase.minecraftVersion !== delta.minecraftVersion ||
      (delta.baseVersion !== null && deltaBase.packVersion !== delta.baseVersion) ||
      summary.packName !== delta.packName ||
      summary.minecraftVersion !== delta.minecraftVersion ||
      (delta.resultVersion !== null && summary.packVersion !== delta.resultVersion))
  ) {
    throw new Error('The update ZIP does not match the installed modpack.');
  }
  const deltaBasePaths = delta === null
    ? null
    : await readPublicationInventory(cache, delta.basePublicationId);
  if (delta !== null && deltaBasePaths === null) {
    throw new Error(
      `Re-add the full ${delta.packName} export once before using update ZIPs.`,
    );
  }
  const deltaFiles = delta === null
    ? null
    : new Map(delta.files.map(file => [file.path, file] as const));
  const deltaDeletedPaths = delta === null ? null : new Set(delta.deletedPaths);
  const deltaResultPaths = deltaBasePaths === null
    ? null
    : new Set(deltaBasePaths.filter(path => !deltaDeletedPaths?.has(path)));
  if (deltaResultPaths !== null && deltaFiles !== null && delta !== null) {
    for (const deletedPath of delta.deletedPaths) {
      if (!deltaBasePaths?.includes(deletedPath)) {
        throw new Error(`The installed full export does not contain ${deletedPath}.`);
      }
    }
    for (const path of deltaFiles.keys()) deltaResultPaths.add(path);
    if (deltaResultPaths.size !== delta.counts.resultFiles) {
      throw new Error('The update ZIP does not match the installed export file list.');
    }
  }
  const previousStoredPaths = await readPublicationInventory(cache, publicationId);
  const storedPaths = new Set<string>();
  let entryCount = 0;
  let archiveError: Error | null = null;
  let writeError: Error | null = null;
  const writeLanes = Array.from({length: CACHE_WRITE_CONCURRENCY}, () => Promise.resolve());
  const pendingWriteJobs = new Set<Promise<void>>();
  let nextWriteLane = 0;
  let queuedWrites = 0;
  let completedWrites = 0;
  let archiveReadComplete = false;
  let lastReportedSavePercent = -1;
  const expectedWrites = delta === null ? null : Math.max(0, delta.counts.resultFiles - 1);

  const queueCacheOperation = (operation: () => Promise<void>) => {
    const lane = nextWriteLane;
    nextWriteLane = (nextWriteLane + 1) % writeLanes.length;
    queuedWrites += 1;
    const job = writeLanes[lane]
      .then(async () => {
        if (writeError !== null) return;
        await operation();
        completedWrites += 1;
        reportSaveProgress();
      })
      .catch(error => {
        writeError = error instanceof Error ? error : new Error(String(error));
      });
    writeLanes[lane] = job;
    pendingWriteJobs.add(job);
    void job.finally(() => pendingWriteJobs.delete(job));
  };

  const queueCacheWrite = (
    relativePath: string,
    body: Blob,
    expected: LocalPackDeltaFile | null,
  ) => {
    queueCacheOperation(async () => {
      if (expected !== null) {
        if (body.size !== expected.size) {
          throw new Error(`The update ZIP has the wrong size for ${relativePath}.`);
        }
        const bodyHash = await sha256ForBytes(new Uint8Array(await body.arrayBuffer()));
        if (bodyHash !== expected.sha256) {
          throw new Error(`The update ZIP failed its integrity check for ${relativePath}.`);
        }
      }
      await cache.put(
        localPackRequest(publicationId, relativePath),
        new Response(body, {
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': contentType(relativePath),
          },
        }),
      );
    });
  };

  const queueCacheCopy = (relativePath: string) => {
    if (delta === null) throw new Error('Internal update copy state is unavailable.');
    queueCacheOperation(async () => {
      const response = await cache.match(
        localPackRequest(delta.basePublicationId, relativePath),
      );
      if (!response) {
        throw new Error(
          `The installed full export is missing ${relativePath}. Re-add the full export and try again.`,
        );
      }
      await cache.put(localPackRequest(publicationId, relativePath), response);
    });
  };

  const throwWriteFailure = (): never => {
    const failure = writeError;
    if (
      failure !== null &&
      (failure.message.startsWith('The update ZIP') ||
        failure.message.startsWith('The installed full export'))
    ) {
      throw failure;
    }
    console.error('A local pack file could not be saved.', failure);
    throw new Error('There is not enough browser storage to keep this pack.');
  };

  const applyWriteBackpressure = async () => {
    while (pendingWriteJobs.size >= CACHE_WRITE_BACKLOG && writeError === null) {
      await Promise.race(pendingWriteJobs);
    }
    if (writeError !== null) {
      throwWriteFailure();
    }
  };

  const reportSaveProgress = () => {
    if (!archiveReadComplete) return;
    const totalWrites = expectedWrites ?? queuedWrites;
    const fraction = totalWrites === 0 ? 1 : completedWrites / totalWrites;
    const percent = Math.floor(fraction * 100);
    if (percent === lastReportedSavePercent && completedWrites !== totalWrites) return;
    lastReportedSavePercent = percent;
    onProgress({
      phase: 'saving',
      fraction,
      completedFiles: completedWrites,
      totalFiles: totalWrites,
    });
  };

  const unzip = new Unzip(entry => {
    entryCount += 1;
    if (entryCount > MAX_EXPORT_ARCHIVE_ENTRIES) {
      archiveError = new Error('This ZIP contains too many files to open safely.');
      return;
    }

    let safePath: string;
    try {
      safePath = requireSafeArchivePath(entry.name);
    } catch (error) {
      archiveError = error instanceof Error ? error : new Error(String(error));
      return;
    }
    if (entry.name.endsWith('/')) return;
    const relativePath = relativeExportPath(safePath, prefix);
    if (relativePath === null || relativePath.length === 0) return;
    if (isIgnoredArchiveMetadataPath(relativePath)) return;
    if (delta !== null && relativePath === 'delta.json') return;
    const expectedDeltaFile = deltaFiles?.get(relativePath) ?? null;
    if (delta !== null && expectedDeltaFile === null) {
      archiveError = new Error(`The update ZIP contains an undeclared file: ${relativePath}.`);
      return;
    }
    if (storedPaths.has(relativePath)) {
      archiveError = new Error(`The ZIP contains the same file twice: ${relativePath}`);
      return;
    }
    storedPaths.add(relativePath);

    if (entry.originalSize !== undefined && entry.originalSize > MAX_LOCAL_FILE_BYTES) {
      archiveError = new Error(`The file ${relativePath} is too large to open in the viewer.`);
      return;
    }
    if (
      expectedDeltaFile !== null &&
      entry.originalSize !== undefined &&
      entry.originalSize !== expectedDeltaFile.size
    ) {
      archiveError = new Error(`The update ZIP has the wrong size for ${relativePath}.`);
      return;
    }

    let bytes = 0;
    let chunks: ArrayBuffer[] = [];
    entry.ondata = (error, data, final) => {
      if (error) {
        archiveError = new Error(`The ZIP could not read ${relativePath}.`);
        return;
      }
      bytes += data.byteLength;
      if (bytes > MAX_LOCAL_FILE_BYTES) {
        archiveError = new Error(`The file ${relativePath} is too large to open in the viewer.`);
        chunks = [];
        return;
      }
      const copied = new Uint8Array(data.byteLength);
      copied.set(data);
      chunks.push(copied.buffer);
      if (!final) return;
      if (relativePath === 'manifest.json') {
        chunks = [];
        return;
      }
      const body = new Blob(chunks, {type: contentType(relativePath)});
      chunks = [];
      queueCacheWrite(relativePath, body, expectedDeltaFile);
    };
    try {
      entry.start();
    } catch {
      archiveError = new Error(`The ZIP could not read ${relativePath}.`);
    }
  });
  unzip.register(UnzipInflate);

  try {
    for (let offset = 0; offset < file.size; offset += ARCHIVE_READ_CHUNK_BYTES) {
      const end = Math.min(offset + ARCHIVE_READ_CHUNK_BYTES, file.size);
      const chunk = await readLocalFileSlice(file, offset, end, loadedBytes => {
        if (loadedBytes >= end - offset) return;
        onProgress({
          phase: 'reading',
          fraction: (offset + loadedBytes) / file.size,
          completedBytes: offset + loadedBytes,
          totalBytes: file.size,
          discoveredFiles: storedPaths.size,
        });
      });
      try {
        unzip.push(chunk, end === file.size);
      } catch {
        throw new Error('The ZIP could not be opened.');
      }
      if (archiveError !== null) throw archiveError;
      onProgress({
        phase: 'reading',
        fraction: end / file.size,
        completedBytes: end,
        totalBytes: file.size,
        discoveredFiles: storedPaths.size,
      });
      await applyWriteBackpressure();
    }
    if (delta !== null && deltaFiles !== null && deltaResultPaths !== null) {
      for (const expectedPath of deltaFiles.keys()) {
        if (!storedPaths.has(expectedPath)) {
          throw new Error(`The update ZIP is missing ${expectedPath}.`);
        }
      }
      archiveReadComplete = true;
      reportSaveProgress();
      const unchangedPaths = [...deltaResultPaths]
        .filter(path => !deltaFiles.has(path))
        .sort();
      for (const unchangedPath of unchangedPaths) {
        storedPaths.add(unchangedPath);
        queueCacheCopy(unchangedPath);
        await applyWriteBackpressure();
      }
      if (queuedWrites !== expectedWrites) {
        throw new Error('The update ZIP produced an inconsistent saved file count.');
      }
    } else {
      archiveReadComplete = true;
      reportSaveProgress();
    }
    await Promise.all(writeLanes);
    if (writeError !== null) {
      throwWriteFailure();
    }

    onProgress({phase: 'finalizing'});

    for (const requiredPath of ['manifest.json', 'items.json', 'categories.json', 'index.json']) {
      if (!storedPaths.has(requiredPath)) {
        throw new Error(`The ZIP is missing ${requiredPath}. Run the exporter again.`);
      }
    }

    if (!isRecord(manifest)) {
      throw new Error('The exporter information in this ZIP is unreadable.');
    }
    const localManifest = {...manifest, publicationId};
    await cache.put(
      localPackRequest(publicationId, 'manifest.json'),
      new Response(JSON.stringify(localManifest), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
        },
      }),
    );
    await writePublicationInventory(cache, publicationId, storedPaths);

    if (previousStoredPaths !== null) {
      const stalePaths = previousStoredPaths.filter(path => !storedPaths.has(path));
      await deletePublicationPaths(cache, publicationId, stalePaths);
    }

    const current = await readCatalog(cache);
    const nextRecord: LocalPackRecord = {...descriptor, storedAt: Date.now()};
    const retained = current.packs.filter(
      pack => pack.publicationId !== publicationId,
    );
    const orderedPacks = [nextRecord, ...retained].sort(
      (left, right) => right.storedAt - left.storedAt,
    );
    const nextPacks = orderedPacks.slice(0, MAX_LOCAL_PACKS);
    await writeCatalog(cache, {format: LOCAL_CATALOG_FORMAT, packs: nextPacks});

    const retainedIds = new Set(nextPacks.map(pack => pack.publicationId));
    const publicationsToDelete = [
      ...new Set(
        orderedPacks
          .slice(MAX_LOCAL_PACKS)
          .filter(pack => !retainedIds.has(pack.publicationId))
          .map(pack => pack.publicationId),
      ),
    ];
    for (const oldPublicationId of publicationsToDelete) {
      await deletePublication(cache, oldPublicationId);
    }

    return {
      descriptor,
      viewerHref: `/?pack=${encodeURIComponent(descriptor.slug)}`,
    };
  } catch (error) {
    await Promise.all(writeLanes);
    await deletePublication(cache, publicationId, storedPaths).catch(cleanupError => {
      console.error('An incomplete local pack could not be removed.', cleanupError);
    });
    throw error;
  }
}
