import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const webSource = await readFile(new URL('./publishedDatasetCache.ts', import.meta.url), 'utf8');
const nativeSource = await readFile(
  new URL('./publishedDatasetCache.native.ts', import.meta.url),
  'utf8',
);

test('the web fallback is a true no-op, matching readLocalDatasetDocument.ts', () => {
  assert.match(webSource, /export async function readCachedPublishedDocument\(\s*_url: string,\s*\): Promise<CachedPublishedDocument \| null> \{\s*return null;\s*\}/u);
  assert.match(webSource, /export async function writeCachedPublishedDocument\(_url: string, _text: string\): Promise<void> \{\}/u);
});

test('cache entries are keyed by a SHA-256 hash of the full URL, not a raw path', () => {
  assert.match(nativeSource, /Crypto\.digest\(Crypto\.CryptoDigestAlgorithm\.SHA256, copy\)/u);
  assert.match(nativeSource, /async function hashKeyForUrl\(url: string\)/u);
});

test('a stored entry is rejected as a miss if its URL or byte count no longer matches', () => {
  assert.match(nativeSource, /if \(!entry \|\| entry\.url !== url\) return null;/u);
  assert.match(nativeSource, /if \(bytes !== entry\.bytes\) return null;/u);
});

test('the cache is pruned oldest-stored-first once it exceeds its byte budget', () => {
  assert.match(nativeSource, /MAX_CACHE_BYTES = 96 \* 1024 \* 1024/u);
  assert.match(nativeSource, /left\.storedAt - right\.storedAt/u);
  assert.match(nativeSource, /if \(totalBytes <= MAX_CACHE_BYTES\) break;/u);
});

test('read and write failures degrade gracefully instead of throwing', () => {
  const readFn = nativeSource.slice(
    nativeSource.indexOf('export async function readCachedPublishedDocument'),
    nativeSource.indexOf('export async function writeCachedPublishedDocument'),
  );
  const writeFn = nativeSource.slice(
    nativeSource.indexOf('export async function writeCachedPublishedDocument'),
  );
  assert.match(readFn, /catch \(error\) \{[\s\S]*?return null;\s*\}/u);
  assert.match(writeFn, /catch \(error\) \{[\s\S]*?console\.error/u);
});
