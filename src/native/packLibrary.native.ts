import {Directory, File, Paths} from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import {datasetSource, type DatasetDescriptor, type DatasetSource} from '../data/datasetCatalog';
import {downloadPack, type DownloadProgress} from './packDownload';
export const PUBLIC_ORIGIN = 'https://minecraftrecipetree.craftsmannsoftware.com';
export interface SavedDownload {descriptor: DatasetDescriptor; downloadedAt: number; bytes: number}
function accountRoot(userId: string): Directory {
  if (!/^[a-f0-9-]{36}$/i.test(userId)) throw new Error('A valid account is required for downloads.');
  return new Directory(Paths.document, 'account-packs', userId);
}
function packRoot(userId: string, descriptor: DatasetDescriptor): Directory {
  datasetSource(descriptor, PUBLIC_ORIGIN);
  return new Directory(accountRoot(userId), `${descriptor.publicationId}-${descriptor.previewAssetSetId}`);
}
export function listDownloads(userId: string): SavedDownload[] {
  const root = accountRoot(userId);
  if (!root.exists) return [];
  return root.list().filter(entry => entry instanceof Directory && !entry.name.startsWith('.')).map(entry => {
    const receipt = new File(entry as Directory, 'ready.json');
    if (!receipt.exists) throw new Error('An incomplete pack was found in the downloaded library.');
    const value = JSON.parse(receipt.textSync()) as SavedDownload;
    datasetSource(value.descriptor, PUBLIC_ORIGIN);
    if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) throw new Error('A download receipt is invalid.');
    return value;
  });
}
export function savedSource(userId: string, descriptor: DatasetDescriptor): DatasetSource | null {
  const root = packRoot(userId, descriptor);
  if (!new File(root, 'ready.json').exists) return null;
  return {descriptor, base: new Directory(root, 'exports').uri.replace(/\/$/, ''), previewBase: new Directory(root, 'previews').uri.replace(/\/$/, '')};
}
export function removeDownload(userId: string, descriptor: DatasetDescriptor): void {
  const root = packRoot(userId, descriptor);
  if (!root.exists) throw new Error('This download is no longer on the device.');
  root.delete();
}
let downloading = false;
export async function saveDownload(userId: string, descriptor: DatasetDescriptor, signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void): Promise<void> {
  if (downloading) throw new Error('Wait for the current pack download to finish.');
  downloading = true;
  const staging = new Directory(accountRoot(userId), `.incoming-${descriptor.publicationId}`);
  let downloadedBytes = 0;
  try {
    if (staging.exists) staging.delete();
    staging.create({intermediates: true});
    await downloadPack(descriptor, PUBLIC_ORIGIN, {
      async read(url, maximumBytes, requestSignal) {
        const response = await fetch(url, {signal: requestSignal, redirect: 'error'});
        if (!response.ok) throw new Error(`Download failed (${response.status}): ${new URL(url).pathname}`);
        const length = Number(response.headers.get('X-MRT-Stored-Bytes'));
        if (!Number.isSafeInteger(length) || length <= 0 || length > maximumBytes) throw new Error('The server did not provide a bounded download size.');
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength !== length) throw new Error('The downloaded file was truncated.');
        return data;
      },
      async write(path, data) {
        const file = new File(staging, ...path.split('/'));
        file.create({intermediates: true, overwrite: true}); file.write(data);
        // Yield between files to keep cancellation and progress responsive.
        await new Promise(resolve => setTimeout(resolve, 0));
      },
      async sha256(data) {
        const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(data));
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      },
    }, signal, progress => { downloadedBytes = progress.bytes; onProgress(progress); });
    signal.throwIfAborted();
    new File(staging, 'ready.json').write(JSON.stringify({descriptor, downloadedAt: Date.now(), bytes: downloadedBytes}));
    const destination = packRoot(userId, descriptor);
    if (destination.exists) throw new Error('This exact pack is already downloaded.');
    staging.move(destination);
  } catch (error) {
    console.error('Account pack download did not complete.', {pack: descriptor.slug, error});
    if (staging.exists) staging.delete();
    throw error;
  } finally { downloading = false; }
}
