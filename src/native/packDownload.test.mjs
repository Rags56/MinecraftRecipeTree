import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {downloadPack, downloadPath} from './packDownload.ts';
import {nativeAuthCode} from '../account/nativeAuthCallback.ts';
const descriptor = {slug: 'test-pack', displayName: 'Test', minecraftVersion: '1.20.1', packVersion: '1', publicationId: 'a'.repeat(64), previewAssetSetId: 'b'.repeat(64), isDefault: true};
const encode = value => new TextEncoder().encode(JSON.stringify(value));
function fixture() {
  const shard = encode([{img: 'assets/s/000-0-3.webp', out: [['item|minecraft:stone', 1]]}]);
  return new Map(Object.entries({
    'manifest.json': encode({publicationId: descriptor.publicationId}),
    'items.json': encode({items: [{k: 'item|minecraft:stone', icon: 'assets/s/000-0-3.webp'}]}),
    'categories.json': encode({categories: [{dir: 'recipes/crafting', count: 1}]}),
    'index.json': encode({}), 'mobs.json': encode({mobs: []}), 'blockdrops.json': encode({blocks: {}}),
    'recipes/crafting/recipes.json': encode({format: 'mrt-sharded-json-v1', kind: 'array', count: 1, parts: [{path: 'recipes/crafting/part-000.json', bytes: shard.byteLength, count: 1, start: 0}]}),
    'recipes/crafting/part-000.json': shard,
    'assets/pack-000.bin': new Uint8Array([1,2,3]),
  }));
}
function adapter(files) {
  const written = new Map(), requests = [];
  return {written, requests, io: {
    async read(url) {const parsed = new URL(url); assert.equal(parsed.origin, 'https://example.com'); assert.equal(parsed.search, `?dataset=${descriptor.publicationId}`); const path = parsed.pathname.split('/exports/')[1]; requests.push(path); if (!files.has(path)) throw new Error(`Missing ${path}`); return files.get(path);},
    async write(path, bytes) {written.set(path, bytes);},
    async sha256(bytes) {return createHash('sha256').update(bytes).digest('hex');},
  }};
}
test('downloads every recipe shard and deduplicates image packs without requesting individual previews', async () => {
  const files = fixture(), {io, written, requests} = adapter(files), progress = [];
  await downloadPack(descriptor, 'https://example.com', io, new AbortController().signal, p => progress.push(p));
  assert.equal(written.size, files.size);
  assert.equal(requests.filter(path => path.endsWith('.bin')).length, 1);
  assert.equal(progress.at(-1).pending, 0);
  assert.ok(written.has('exports/recipes/crafting/part-000.json'));
});
test('refuses a publication mismatch before writing the bootstrap', async () => {
  const files = fixture(); files.set('manifest.json', encode({publicationId: 'c'.repeat(64)}));
  const {io, written} = adapter(files);
  await assert.rejects(downloadPack(descriptor, 'https://example.com', io, new AbortController().signal, () => {}), /does not match/);
  assert.equal(written.size, 0);
});
test('rejects truncated recipe shards', async () => {
  const files = fixture(), {io} = adapter(files); files.set('recipes/crafting/part-000.json', encode([]));
  await assert.rejects(downloadPack(descriptor, 'https://example.com', io, new AbortController().signal, () => {}), /size mismatch/);
});
test('cancellation stops further requests and writes', async () => {
  const controller = new AbortController(), {io, requests} = adapter(fixture());
  await assert.rejects(downloadPack(descriptor, 'https://example.com', io, controller.signal, () => controller.abort()), /abort/i);
  assert.equal(requests.length, 1);
});
test('download paths cannot escape their staging directory or origin', () => {
  for (const path of ['../secret', '/etc/passwd', 'a//b', 'a/../b', 'https://evil.test/file', 'a%2fb', 'a\\b']) assert.throws(() => downloadPath(path), /unsafe/);
});
test('native OAuth accepts only one code addressed to the exact app callback', () => {
  assert.equal(nativeAuthCode('minecraft-recipe-tree://auth/callback?code=hello'), 'hello');
  for (const url of ['https://evil.test/?code=hi', 'minecraft-recipe-tree://auth/other?code=hi', 'minecraft-recipe-tree://auth/callback?code=a&code=b', 'minecraft-recipe-tree://auth/callback']) assert.throws(() => nativeAuthCode(url));
  assert.throws(() => nativeAuthCode('minecraft-recipe-tree://auth/callback?error=denied&error_description=Access%20denied'), /Access denied/);
});
