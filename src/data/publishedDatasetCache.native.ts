import * as Crypto from 'expo-crypto';
import {Directory, File as NativeFile, Paths} from 'expo-file-system';
import type {CachedPublishedDocument} from './publishedDatasetCache';

const ROOT_DIRECTORY_NAME = 'minecraft-recipe-tree';
const CACHE_DIRECTORY_NAME = 'published-dataset-cache';
const INDEX_FILE_NAME = 'index.json';
const INDEX_FORMAT = 1;
// Every cached document is content-addressed by its full URL (which already embeds the
// publication's SHA-256 identity via versionExportUrl), so this only ever bounds total on-device
// bytes -- it is never a staleness risk, matching the reasoning behind the web service worker's
// equally long-lived cache for the same documents.
const MAX_CACHE_BYTES = 96 * 1024 * 1024;

interface CacheIndexEntry {
  url: string;
  bytes: number;
  storedAt: number;
}

interface CacheIndex {
  format: typeof INDEX_FORMAT;
  entries: Record<string, CacheIndexEntry>;
}

function cacheDirectory(): Directory {
  return new Directory(Paths.cache, ROOT_DIRECTORY_NAME, CACHE_DIRECTORY_NAME);
}

function indexFile(): NativeFile {
  return new NativeFile(cacheDirectory(), INDEX_FILE_NAME);
}

function emptyIndex(): CacheIndex {
  return {format: INDEX_FORMAT, entries: {}};
}

function isValidIndex(value: unknown): value is CacheIndex {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as CacheIndex).format === INDEX_FORMAT &&
    !!(value as CacheIndex).entries &&
    typeof (value as CacheIndex).entries === 'object'
  );
}

async function readIndex(): Promise<CacheIndex> {
  const file = indexFile();
  if (!file.exists) return emptyIndex();
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    return isValidIndex(parsed) ? parsed : emptyIndex();
  } catch (error) {
    console.error('The published dataset cache index is corrupt; starting empty.', error);
    return emptyIndex();
  }
}

function writeIndex(index: CacheIndex): void {
  cacheDirectory().create({idempotent: true, intermediates: true});
  const file = indexFile();
  file.create({intermediates: true, overwrite: true});
  file.write(JSON.stringify(index));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashKeyForUrl(url: string): Promise<string> {
  const source = new TextEncoder().encode(url);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return hex(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, copy)));
}

/** Deletes oldest-stored entries first until the cache is back under its byte budget. */
function pruneIndex(index: CacheIndex): void {
  let totalBytes = Object.values(index.entries).reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes <= MAX_CACHE_BYTES) return;
  const oldestFirst = Object.entries(index.entries).sort(
    ([, left], [, right]) => left.storedAt - right.storedAt,
  );
  for (const [key, entry] of oldestFirst) {
    if (totalBytes <= MAX_CACHE_BYTES) break;
    const file = new NativeFile(cacheDirectory(), key);
    if (file.exists) file.delete();
    delete index.entries[key];
    totalBytes -= entry.bytes;
  }
}

export async function readCachedPublishedDocument(
  url: string,
): Promise<CachedPublishedDocument | null> {
  try {
    const key = await hashKeyForUrl(url);
    const index = await readIndex();
    const entry = index.entries[key];
    if (!entry || entry.url !== url) return null;
    const file = new NativeFile(cacheDirectory(), key);
    if (!file.exists) return null;
    const text = await file.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes !== entry.bytes) return null;
    return {text, bytes};
  } catch (error) {
    console.error('The published dataset cache could not be read; fetching from the network.', {
      url,
      error,
    });
    return null;
  }
}

export async function writeCachedPublishedDocument(url: string, text: string): Promise<void> {
  try {
    const bytes = new TextEncoder().encode(text).byteLength;
    const key = await hashKeyForUrl(url);
    cacheDirectory().create({idempotent: true, intermediates: true});
    const file = new NativeFile(cacheDirectory(), key);
    file.create({intermediates: true, overwrite: true});
    file.write(text);
    const index = await readIndex();
    index.entries[key] = {url, bytes, storedAt: Date.now()};
    pruneIndex(index);
    writeIndex(index);
  } catch (error) {
    console.error('The published dataset cache could not be written; continuing without it.', {
      url,
      error,
    });
  }
}
