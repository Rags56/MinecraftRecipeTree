import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {strToU8, zipSync} from 'fflate';

import {requireLocalPackDelta} from './localPackDelta.ts';
import {
  installLocalPackArchive,
  listLocalPackDescriptors,
  removeLocalPack,
} from './localPackStorage.ts';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function summary(version) {
  return {
    packName: 'Delta Pack',
    packVersion: version,
    minecraftVersion: '1.20.1',
    readyForHandoff: true,
    findings: [],
    counts: {items: 0, recipes: 0, categories: 0, failures: 0},
  };
}

test('retains independently usable local versions across chained delta updates', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const responses = new Map();
  const cache = {
    async match(request) {
      return responses.get(request.url)?.clone();
    },
    async put(request, response) {
      responses.set(request.url, response.clone());
    },
    async delete(request) {
      return responses.delete(request.url);
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {location: {origin: 'https://viewer.example'}, clearTimeout, setTimeout},
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        controller: {
          scriptURL: 'https://viewer.example/local-pack-sw.js?v=packed-images-and-shell-v1',
        },
        ready: Promise.resolve(),
        async register() {},
      },
    },
  });
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {async open() { return cache; }},
  });

  try {
    const baseManifest = {
      format: 1,
      generatedAt: '2026-08-01T00:00:00Z',
      aborted: false,
      pack: {name: 'Delta Pack', version: '1.0.0'},
      minecraft: '1.20.1',
    };
    const resultManifest = {
      ...baseManifest,
      generatedAt: '2026-08-02T00:00:00Z',
      pack: {name: 'Delta Pack', version: '1.0.1'},
    };
    const baseFiles = {
      'manifest.json': strToU8(JSON.stringify(baseManifest)),
      'items.json': strToU8('{"items":[]}'),
      'categories.json': strToU8('{"categories":[]}'),
      'index.json': strToU8('{}'),
      'unchanged.txt': strToU8('keep this'),
      'removed.txt': strToU8('remove this'),
    };
    const fullArchive = zipSync(baseFiles);
    const baseInstalled = await installLocalPackArchive(
      new File([fullArchive], 'delta-pack-full.zip', {type: 'application/zip'}),
      'manifest.json',
      baseFiles['manifest.json'],
      baseManifest,
      summary('1.0.0'),
      () => {},
    );

    const changedFiles = {
      'manifest.json': strToU8(JSON.stringify(resultManifest)),
      'items.json': strToU8('{"items":[{"k":"minecraft:stone"}]}'),
      'added.txt': strToU8('new file'),
    };
    const resultFiles = {
      ...changedFiles,
      'categories.json': baseFiles['categories.json'],
      'index.json': baseFiles['index.json'],
      'unchanged.txt': baseFiles['unchanged.txt'],
    };
    const basePublicationId = sha256(baseFiles['manifest.json']);
    const resultPublicationId = sha256(changedFiles['manifest.json']);
    const deltaDocument = {
      format: 'mrt-export-delta-v1',
      createdAt: '2026-08-02T00:00:01Z',
      basePublicationId,
      resultPublicationId,
      minecraft: '1.20.1',
      pack: {name: 'Delta Pack', baseVersion: '1.0.0', resultVersion: '1.0.1'},
      files: Object.entries(changedFiles).map(([path, bytes]) => ({
        path,
        size: bytes.byteLength,
        sha256: sha256(bytes),
      })),
      deletedPaths: ['removed.txt'],
      counts: {
        changedFiles: 3,
        deletedFiles: 1,
        unchangedFiles: 3,
        resultFiles: 6,
        changedBytes: Object.values(changedFiles).reduce((sum, bytes) => sum + bytes.byteLength, 0),
        resultBytes: Object.values(resultFiles).reduce((sum, bytes) => sum + bytes.byteLength, 0),
      },
    };
    const parsedDelta = requireLocalPackDelta(deltaDocument);
    const updateArchive = zipSync({
      'delta.json': strToU8(JSON.stringify(deltaDocument)),
      ...changedFiles,
    });
    const progress = [];
    const installed = await installLocalPackArchive(
      new File([updateArchive], 'delta-pack-update.zip', {type: 'application/zip'}),
      'manifest.json',
      changedFiles['manifest.json'],
      resultManifest,
      summary('1.0.1'),
      update => progress.push(update),
      parsedDelta,
    );

    assert.equal(installed.descriptor.packVersion, '1.0.1');
    const resultPrefix = `https://viewer.example/__local-packs/${resultPublicationId}/exports/`;
    assert.equal(await responses.get(`${resultPrefix}unchanged.txt`)?.clone().text(), 'keep this');
    assert.equal(await responses.get(`${resultPrefix}added.txt`)?.clone().text(), 'new file');
    assert.equal(responses.has(`${resultPrefix}removed.txt`), false);
    assert.equal(
      [...responses.keys()].some(url => url.includes(`/__local-packs/${basePublicationId}/`)),
      true,
    );
    const saving = progress.filter(update => update.phase === 'saving');
    assert.deepEqual(saving.at(-1), {
      phase: 'saving',
      fraction: 1,
      completedFiles: 5,
      totalFiles: 5,
    });
    const catalog = await responses
      .get('https://viewer.example/__local-packs/catalog.json')
      ?.clone()
      .json();
    assert.deepEqual(catalog.packs.map(pack => pack.packVersion), ['1.0.1', '1.0.0']);
    assert.deepEqual(
      (await listLocalPackDescriptors()).map(pack => pack.packVersion),
      ['1.0.1', '1.0.0'],
    );

    const chainedManifest = {
      ...resultManifest,
      generatedAt: '2026-08-03T00:00:00Z',
      pack: {name: 'Delta Pack', version: '1.0.2'},
    };
    const chainedManifestBytes = strToU8(JSON.stringify(chainedManifest));
    const chainedPublicationId = sha256(chainedManifestBytes);
    const chainedDeltaDocument = {
      format: 'mrt-export-delta-v1',
      createdAt: '2026-08-03T00:00:01Z',
      basePublicationId: resultPublicationId,
      resultPublicationId: chainedPublicationId,
      minecraft: '1.20.1',
      pack: {name: 'Delta Pack', baseVersion: '1.0.1', resultVersion: '1.0.2'},
      files: [{
        path: 'manifest.json',
        size: chainedManifestBytes.byteLength,
        sha256: sha256(chainedManifestBytes),
      }],
      deletedPaths: [],
      counts: {
        changedFiles: 1,
        deletedFiles: 0,
        unchangedFiles: 5,
        resultFiles: 6,
        changedBytes: chainedManifestBytes.byteLength,
        resultBytes:
          chainedManifestBytes.byteLength +
          Object.entries(resultFiles)
            .filter(([path]) => path !== 'manifest.json')
            .reduce((sum, [, bytes]) => sum + bytes.byteLength, 0),
      },
    };
    const chainedArchive = zipSync({
      'delta.json': strToU8(JSON.stringify(chainedDeltaDocument)),
      'manifest.json': chainedManifestBytes,
    });
    const chainedInstalled = await installLocalPackArchive(
      new File([chainedArchive], 'delta-pack-update-2.zip', {type: 'application/zip'}),
      'manifest.json',
      chainedManifestBytes,
      chainedManifest,
      summary('1.0.2'),
      () => {},
      requireLocalPackDelta(chainedDeltaDocument),
    );
    assert.deepEqual(
      (await listLocalPackDescriptors()).map(pack => pack.packVersion),
      ['1.0.2', '1.0.1', '1.0.0'],
    );
    const chainedPrefix =
      `https://viewer.example/__local-packs/${chainedPublicationId}/exports/`;
    assert.equal(await responses.get(`${chainedPrefix}unchanged.txt`)?.clone().text(), 'keep this');

    assert.equal(await removeLocalPack(installed.descriptor.slug), true);
    assert.deepEqual(
      (await listLocalPackDescriptors()).map(pack => pack.packVersion),
      ['1.0.2', '1.0.0'],
    );
    assert.equal(
      [...responses.keys()].some(url => url.includes(`/__local-packs/${resultPublicationId}/`)),
      false,
    );
    assert.equal(
      [...responses.keys()].some(url => url.includes(`/__local-packs/${basePublicationId}/`)),
      true,
    );
    assert.equal(
      [...responses.keys()].some(url => url.includes(`/__local-packs/${chainedPublicationId}/`)),
      true,
    );
    assert.equal(await removeLocalPack(chainedInstalled.descriptor.slug), true);
    assert.equal(await removeLocalPack(baseInstalled.descriptor.slug), true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else delete globalThis.caches;
  }
});
