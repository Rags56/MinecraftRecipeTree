import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {strToU8, zipSync} from 'fflate';

const {
  installLocalPackArchive,
  listLocalPackDescriptors,
  registerLocalPackServiceWorker,
  removeLocalPack,
} = await import('./localPackStorage.ts');

test('service worker preparation has a bounded failure instead of blocking catalog loading', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const listeners = new Set();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      clearTimeout() {},
      setTimeout(callback) {
        queueMicrotask(callback);
        return 1;
      },
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        controller: null,
        ready: new Promise(() => {}),
        async register() {},
        addEventListener(_name, listener) { listeners.add(listener); },
        removeEventListener(_name, listener) { listeners.delete(listener); },
      },
    },
  });
  try {
    await assert.rejects(
      registerLocalPackServiceWorker(),
      /could not finish preparing its image cache/u,
    );
    assert.equal(listeners.size, 0);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('local pack requests use exact cache keys instead of full-cache scans', async () => {
  const source = await readFile(new URL('../../public/local-pack-sw.js', import.meta.url), 'utf8');
  assert.match(source, /url\.search = '';/u);
  assert.match(source, /cache\.match\(url\.href\)/u);
  assert.doesNotMatch(source, /ignoreSearch\s*:/u);
});

test('reports file-saving and finalization after archive reading reaches 100%', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const responses = new Map();
  let activeFileWrites = 0;
  let maximumActiveFileWrites = 0;
  const cache = {
    async match(request) {
      return responses.get(request.url)?.clone();
    },
    async put(request, response) {
      const isPackFile = request.url.includes('/__local-packs/') && request.url.includes('/exports/');
      if (isPackFile) {
        activeFileWrites += 1;
        maximumActiveFileWrites = Math.max(maximumActiveFileWrites, activeFileWrites);
      }
      try {
        await new Promise(resolve => setTimeout(resolve, isPackFile ? 2 : 0));
        responses.set(request.url, response.clone());
      } finally {
        if (isPackFile) activeFileWrites -= 1;
      }
    },
    async keys() {
      throw new DOMException('Operation too large.', 'QuotaExceededError');
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
    const manifest = {
      format: 'jei-export-v2',
      minecraft: '1.20.1',
      pack: {name: 'Progress Pack', version: '1.0.0'},
    };
    const manifestBytes = strToU8(JSON.stringify(manifest));
    const archive = zipSync({
      'manifest.json': manifestBytes,
      'items.json': strToU8('[]'),
      'categories.json': strToU8('[]'),
      'index.json': strToU8('{}'),
      '._items.json': strToU8('Finder metadata'),
      '.DS_Store': strToU8('Finder metadata'),
      '__MACOSX/._items.json': strToU8('Finder metadata'),
    });
    const file = new File([archive], 'progress-pack.zip', {type: 'application/zip'});
    const updates = [];

    await installLocalPackArchive(
      file,
      'manifest.json',
      manifestBytes,
      manifest,
      {
        packName: 'Progress Pack',
        packVersion: '1.0.0',
        minecraftVersion: '1.20.1',
        readyForHandoff: true,
        findings: [],
        counts: {items: 0, recipes: 0, categories: 0, failures: 0},
      },
      update => updates.push(update),
    );

    assert.deepEqual(updates[0], {
      phase: 'reading',
      fraction: 1,
      completedBytes: file.size,
      totalBytes: file.size,
      discoveredFiles: 4,
    });
    const saving = updates.filter(update => update.phase === 'saving');
    assert.deepEqual(saving[0], {
      phase: 'saving',
      fraction: 0,
      completedFiles: 0,
      totalFiles: 3,
    });
    assert.deepEqual(saving.at(-1), {
      phase: 'saving',
      fraction: 1,
      completedFiles: 3,
      totalFiles: 3,
    });
    assert.deepEqual(updates.at(-1), {phase: 'finalizing'});
    assert.ok(maximumActiveFileWrites > 1);
    assert.ok(maximumActiveFileWrites <= 4);
    assert.equal(
      [...responses.keys()].some(url => /(?:__MACOSX|\.DS_Store|\/\._)/u.test(url)),
      false,
    );

    const firstInventoryUrl = [...responses.keys()].find(url => url.endsWith('/inventory.json'));
    assert.ok(firstInventoryUrl);
    responses.delete(firstInventoryUrl);

    const updatedManifest = {
      ...manifest,
      pack: {name: 'Progress Pack', version: '1.0.1'},
    };
    const updatedManifestBytes = strToU8(JSON.stringify(updatedManifest));
    const updatedArchive = zipSync({
      'manifest.json': updatedManifestBytes,
      'items.json': strToU8('[]'),
      'categories.json': strToU8('[]'),
      'index.json': strToU8('{}'),
    });
    const updatedFile = new File([updatedArchive], 'progress-pack-updated.zip', {
      type: 'application/zip',
    });

    const installed = await installLocalPackArchive(
      updatedFile,
      'manifest.json',
      updatedManifestBytes,
      updatedManifest,
      {
        packName: 'Progress Pack',
        packVersion: '1.0.1',
        minecraftVersion: '1.20.1',
        readyForHandoff: true,
        findings: [],
        counts: {items: 0, recipes: 0, categories: 0, failures: 0},
      },
      () => {},
    );

    assert.equal(installed.descriptor.packVersion, '1.0.1');
    const catalog = await responses
      .get('https://viewer.example/__local-packs/catalog.json')
      ?.clone()
      .json();
    assert.deepEqual(catalog.packs.map(pack => pack.packVersion), ['1.0.1', '1.0.0']);
    assert.deepEqual(
      (await listLocalPackDescriptors()).map(pack => ({
        slug: pack.slug,
        displayName: pack.displayName,
        packVersion: pack.packVersion,
      })),
      [
        {
          slug: installed.descriptor.slug,
          displayName: 'Progress Pack',
          packVersion: '1.0.1',
        },
        {
          slug: catalog.packs[1].slug,
          displayName: 'Progress Pack',
          packVersion: '1.0.0',
        },
      ],
    );

    assert.equal(await removeLocalPack(installed.descriptor.slug), true);
    assert.deepEqual(
      (await listLocalPackDescriptors()).map(pack => pack.packVersion),
      ['1.0.0'],
    );
    assert.equal(await removeLocalPack(installed.descriptor.slug), false);
    assert.equal(
      [...responses.keys()].some(url => url.includes(installed.descriptor.publicationId)),
      false,
    );
    assert.equal(await removeLocalPack(catalog.packs[1].slug), true);
    assert.deepEqual(await listLocalPackDescriptors(), []);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else delete globalThis.caches;
  }
});
