import type {DatasetDescriptor} from '../data/datasetCatalog.ts';
import {datasetSource} from '../data/datasetCatalog.ts';
import {requirePreviewManifest} from '../../worker/previewAssetContract.ts';

export interface DownloadProgress { files: number; bytes: number; pending: number; path: string }
export interface DownloadIO {
  read(url: string, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  sha256(bytes: Uint8Array): Promise<string>;
}
const MAX_FILES = 30_000;
export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export function downloadPath(path: unknown): string {
  if (typeof path !== 'string' || path.length > 1024 || !/^[A-Za-z0-9._/-]+$/.test(path) ||
    path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('The pack contains an unsafe download path.');
  return path;
}

/** Download the viewer's document graph and bounded image packs, never individual image requests. */
export async function downloadPack(descriptor: DatasetDescriptor, origin: string, io: DownloadIO,
  signal: AbortSignal, progress: (value: DownloadProgress) => void): Promise<void> {
  const source = datasetSource(descriptor, origin);
  const jobs: {path: string; preview: boolean; hash?: string; size?: number}[] = [];
  const seen = new Set<string>();
  const enqueue = (path: string, preview = false, hash?: string, size?: number) => {
    downloadPath(path);
    const key = `${preview ? 'previews' : 'exports'}/${path}`;
    if (seen.has(key)) return;
    if (seen.size >= MAX_FILES) throw new Error('This pack exceeds the 30,000-file download limit.');
    seen.add(key); jobs.push({path, preview, hash, size});
  };
  for (const path of ['manifest.json', 'items.json', 'categories.json', 'index.json', 'mobs.json', 'blockdrops.json']) enqueue(path);
  let bytes = 0;
  for (let index = 0; index < jobs.length; index++) {
    signal.throwIfAborted();
    const job = jobs[index];
    const binary = job.path.endsWith('.bin');
    const maximum = binary ? 1024 * 1024 : 8 * 1024 * 1024;
    const query = `?dataset=${descriptor.publicationId}${job.preview ? `&preview=${descriptor.previewAssetSetId}` : ''}`;
    const data = await io.read(`${job.preview ? source.previewBase : source.base}/${job.path}${query}`, maximum, signal);
    if (data.byteLength > maximum || (job.size !== undefined && data.byteLength !== job.size)) throw new Error(`Download size mismatch: ${job.path}`);
    bytes += data.byteLength;
    if (bytes > MAX_DOWNLOAD_BYTES) throw new Error('This pack exceeds the 2 GiB device download limit.');
    if (job.hash && await io.sha256(data) !== job.hash) throw new Error(`Download integrity check failed: ${job.path}`);
    if (!binary) {
      const value = JSON.parse(new TextDecoder().decode(data));
      if (job.path === 'manifest.json' && !job.preview) {
        if (value.publicationId !== descriptor.publicationId) throw new Error('Downloaded pack publication does not match the catalog.');
        if (value.web?.recipeImages?.mode === 'omitted' && value.web.recipeImages.reason === 'hosting-archive-budget') enqueue('manifest.json', true);
      }
      if (job.path === 'manifest.json' && job.preview) {
        const {manifest} = requirePreviewManifest(value, descriptor.previewAssetSetId);
        if (manifest.datasetPublicationId !== descriptor.publicationId) throw new Error('Recipe previews belong to a different pack.');
        for (const record of [...manifest.categoryDocuments, ...manifest.packs]) enqueue(record.path, true, record.sha256, record.bytes);
      }
      if (job.path === 'categories.json' && !job.preview) {
        if (!Array.isArray(value.categories)) throw new Error('The category catalog is invalid.');
        for (const category of value.categories) enqueue(`${downloadPath(category.dir)}/recipes.json`);
      }
      // Only typed shard references and packed image coordinates create extra requests.
      const pending: unknown[] = [value];
      while (pending.length) {
        const node = pending.pop();
        if (typeof node === 'string' && !job.preview) {
          const coordinate = /^assets\/s\/(\d+)-\d+-\d+\.webp$/.exec(node);
          if (coordinate) enqueue(`assets/pack-${String(Number(coordinate[1])).padStart(3, '0')}.bin`);
        } else if (Array.isArray(node)) {
          for (const child of node) pending.push(child);
        } else if (node && typeof node === 'object') {
          const record = node as Record<string, unknown>;
          if (record.format === 'mrt-sharded-json-v1') {
            if (!Array.isArray(record.parts)) throw new Error('Invalid JSON shard list.');
            for (const part of record.parts) enqueue(downloadPath(part.path), job.preview, undefined, part.bytes);
          }
          for (const child of Object.values(record)) pending.push(child);
        }
      }
    }
    await io.write(`${job.preview ? 'previews' : 'exports'}/${job.path}`, data);
    progress({files: index + 1, bytes, pending: jobs.length - index - 1, path: job.path});
  }
}
