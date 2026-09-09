import assert from 'node:assert/strict';
import test from 'node:test';
import {cachedDatasetResponse} from './datasetResponseCache.ts';

const url = `https://viewer.example/dataset/publications/${'a'.repeat(64)}/exports/items.json?dataset=${'a'.repeat(64)}`;
function fixture() {
  const entries = new Map();
  const pending = [];
  return {
    cache: {async match(request) { return entries.get(request.url)?.clone(); }, async put(request, response) { entries.set(request.url, response); }},
    ctx: {waitUntil(p) { pending.push(p); }},
    flush: () => Promise.all(pending), entries,
  };
}
test('validated immutable GET is reused for repeat and HEAD requests without more origin reads', async () => {
  const f = fixture(); let reads = 0;
  const load = async () => { reads++; return new Response('validated', {headers: {'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': '9'}}); };
  const first = await cachedDatasetResponse(new Request(url), load, f.ctx, f.cache);
  assert.equal(first.headers.get('X-Dataset-Cache'), 'MISS');
  await f.flush();
  const repeat = await cachedDatasetResponse(new Request(url), load, f.ctx, f.cache);
  assert.equal(await repeat.text(), 'validated');
  assert.equal(repeat.headers.get('X-Dataset-Cache'), 'HIT');
  const head = await cachedDatasetResponse(new Request(url, {method: 'HEAD'}), load, f.ctx, f.cache);
  assert.equal(await head.text(), ''); assert.equal(head.headers.get('Content-Length'), '9');
  assert.equal(reads, 1);
});
test('errors, mutable responses, cookies, HEAD misses and writes never populate the cache', async () => {
  for (const [method, status, headers] of [
    ['GET', 400, {'Cache-Control': 'no-store'}], ['GET', 200, {'Cache-Control': 'no-store'}],
    ['GET', 200, {'Cache-Control': 'public, immutable', 'Set-Cookie': 'private=1'}],
    ['HEAD', 200, {'Cache-Control': 'public, immutable'}], ['POST', 200, {'Cache-Control': 'public, immutable'}],
  ]) {
    const f = fixture();
    await cachedDatasetResponse(new Request(url, {method}), async () => new Response(null, {status, headers}), f.ctx, f.cache);
    await f.flush(); assert.equal(f.entries.size, 0);
  }
});
test('a mismatched dataset query cannot hit a validated cache entry', async () => {
  const f = fixture();
  await cachedDatasetResponse(new Request(url), async () => new Response('valid', {headers: {'Cache-Control': 'public, immutable'}}), f.ctx, f.cache);
  await f.flush();
  const invalid = await cachedDatasetResponse(new Request(url + '&noise=1'), async () => new Response('Exact query required', {status: 400}), f.ctx, f.cache);
  assert.equal(invalid.status, 400);
});
