const LOCAL_PACK_CACHE = 'minecraft-recipe-tree-local-packs-v1';
const LOCAL_PACK_ROUTE_PREFIX = '/__local-packs/';
const HOSTED_IMAGE_PACK_CACHE = 'minecraft-recipe-tree-hosted-image-packs-v1';
const MAX_PACK_BYTES = 1024 * 1024;
const MAX_MEMORY_PACK_BYTES = 32 * 1024 * 1024;
const MAX_PERSISTENT_PACKS = 192;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CORE_IMAGE_ROUTE =
  /^\/dataset\/publications\/([a-f0-9]{64})\/exports\/assets\/s\/(\d+)-(\d+)-(\d+)\.webp$/;
const PREVIEW_IMAGE_ROUTE =
  /^\/dataset\/preview-sets\/([a-f0-9]{64})\/assets\/s\/(\d+)-(\d+)-(\d+)\.webp$/;

// Content-hashed app bundle chunks and content-addressed dataset export documents (manifest,
// items, index, recipes, category files -- but not the packed image binaries or sprite
// coordinates above, which already have their own cache) are immutable for the life of their URL,
// so a plain cache-first strategy is always safe: the URL itself changes if the content does.
const IMMUTABLE_CONTENT_CACHE = 'minecraft-recipe-tree-immutable-content-v1';
const MAX_IMMUTABLE_CONTENT_BYTES = 96 * 1024 * 1024;
const APP_ASSET_ROUTE = /^\/assets\/[^/]+\.(?:js|css)$/;
const CORE_EXPORT_DOCUMENT_ROUTE =
  /^\/dataset\/publications\/[a-f0-9]{64}\/exports\/(?!assets\/(?:s\/|pack-)).+$/;
const PREVIEW_EXPORT_DOCUMENT_ROUTE =
  /^\/dataset\/preview-sets\/[a-f0-9]{64}\/(?!assets\/(?:s\/|pack-)).+$/;

const pendingImmutableContent = new Map();

const memoryPacks = new Map();
const pendingPacks = new Map();
let memoryPackBytes = 0;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function packedCoordinate(url) {
  let match = CORE_IMAGE_ROUTE.exec(url.pathname);
  let packPath;
  if (match) {
    if (url.search !== `?dataset=${match[1]}`) return null;
    packPath =
      `/dataset/publications/${match[1]}/exports/assets/pack-${match[2]}.bin` +
      url.search;
  } else {
    match = PREVIEW_IMAGE_ROUTE.exec(url.pathname);
    if (!match) return null;
    const query = /^\?dataset=([a-f0-9]{64})&preview=([a-f0-9]{64})$/.exec(url.search);
    if (!query || query[2] !== match[1]) return null;
    packPath =
      `/dataset/preview-sets/${match[1]}/assets/pack-${match[2]}.bin` +
      url.search;
  }

  const packNumber = Number(match[2]);
  const offset = Number(match[3]);
  const length = Number(match[4]);
  if (
    !Number.isSafeInteger(packNumber) ||
    packNumber < 0 ||
    String(packNumber).padStart(3, '0') !== match[2] ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    String(offset) !== match[3] ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    String(length) !== match[4] ||
    !Number.isSafeInteger(offset + length) ||
    offset + length > MAX_PACK_BYTES
  ) {
    return null;
  }
  return {
    packUrl: new URL(packPath, url.origin).href,
    offset,
    length,
  };
}

function hex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function validatedPack(response, packUrl) {
  if (!response.ok) {
    throw new Error(`Image pack request failed with HTTP ${response.status} at ${packUrl}.`);
  }
  const digest = response.headers.get('x-mrt-pack-sha256');
  const storedBytesText = response.headers.get('x-mrt-stored-bytes');
  const contentLengthText = response.headers.get('content-length');
  const storedBytes = Number(storedBytesText);
  if (
    response.headers.get('content-type') !== 'application/octet-stream' ||
    !digest ||
    !SHA256_PATTERN.test(digest) ||
    !/^[1-9]\d*$/.test(storedBytesText ?? '') ||
    !/^[1-9]\d*$/.test(contentLengthText ?? '') ||
    !Number.isSafeInteger(storedBytes) ||
    storedBytes > MAX_PACK_BYTES ||
    contentLengthText !== storedBytesText
  ) {
    throw new Error(`Image pack response has invalid immutable headers at ${packUrl}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== storedBytes) {
    throw new Error(`Image pack response has an invalid byte length at ${packUrl}.`);
  }
  if (!self.crypto?.subtle) {
    throw new Error('This browser cannot verify cached image packs with SHA-256.');
  }
  const observedDigest = hex(
    new Uint8Array(await self.crypto.subtle.digest('SHA-256', bytes.slice().buffer)),
  );
  if (observedDigest !== digest) {
    throw new Error(`Image pack response failed SHA-256 verification at ${packUrl}.`);
  }
  return {bytes, digest};
}

function rememberPack(packUrl, pack) {
  const previous = memoryPacks.get(packUrl);
  if (previous) memoryPackBytes -= previous.bytes.byteLength;
  memoryPacks.delete(packUrl);
  memoryPacks.set(packUrl, pack);
  memoryPackBytes += pack.bytes.byteLength;
  while (memoryPackBytes > MAX_MEMORY_PACK_BYTES && memoryPacks.size > 1) {
    const oldestUrl = memoryPacks.keys().next().value;
    const oldest = memoryPacks.get(oldestUrl);
    memoryPacks.delete(oldestUrl);
    memoryPackBytes -= oldest.bytes.byteLength;
  }
}

async function prunePersistentPacks(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_PERSISTENT_PACKS;
  if (excess <= 0) return;
  const results = await Promise.all(keys.slice(0, excess).map(request => cache.delete(request)));
  if (results.some(deleted => !deleted)) {
    console.error('The hosted image-pack cache could not remove every expired entry.');
  }
}

function isImmutableContentRequest(url) {
  return (
    APP_ASSET_ROUTE.test(url.pathname) ||
    CORE_EXPORT_DOCUMENT_ROUTE.test(url.pathname) ||
    PREVIEW_EXPORT_DOCUMENT_ROUTE.test(url.pathname)
  );
}

// Cache.keys() returns entries in insertion order, so the oldest entries are pruned first.
async function pruneImmutableContent(cache) {
  const keys = await cache.keys();
  const entries = await Promise.all(
    keys.map(async request => {
      const response = await cache.match(request);
      const length = Number(response?.headers.get('content-length'));
      return {request, bytes: Number.isSafeInteger(length) && length >= 0 ? length : 0};
    }),
  );
  let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const entry of entries) {
    if (totalBytes <= MAX_IMMUTABLE_CONTENT_BYTES) break;
    if (!(await cache.delete(entry.request))) {
      console.error('An expired immutable content cache entry could not be removed.');
      continue;
    }
    totalBytes -= entry.bytes;
  }
}

async function immutableContentResponse(request) {
  const cache = await caches.open(IMMUTABLE_CONTENT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const cacheKey = request.url;
  let operation = pendingImmutableContent.get(cacheKey);
  if (!operation) {
    operation = (async () => {
      const response = await fetch(request, {cache: 'no-store'});
      if (response.ok) {
        try {
          await cache.put(request, response.clone());
          await pruneImmutableContent(cache);
        } catch (error) {
          console.error('Immutable content could not be cached; it was still served.', {
            url: request.url,
            error,
          });
        }
      }
      return response;
    })().finally(() => {
      pendingImmutableContent.delete(cacheKey);
    });
    pendingImmutableContent.set(cacheKey, operation);
  }
  return (await operation).clone();
}

async function loadPack(packUrl) {
  const remembered = memoryPacks.get(packUrl);
  if (remembered) {
    rememberPack(packUrl, remembered);
    return remembered;
  }
  const pending = pendingPacks.get(packUrl);
  if (pending) return pending;

  const operation = (async () => {
    const cache = await caches.open(HOSTED_IMAGE_PACK_CACHE);
    const cached = await cache.match(packUrl);
    if (cached) {
      try {
        const pack = await validatedPack(cached, packUrl);
        rememberPack(packUrl, pack);
        return pack;
      } catch (error) {
        console.error('A cached image pack failed validation and will be refetched.', {
          packUrl,
          error,
        });
        if (!(await cache.delete(packUrl))) {
          console.error('The invalid cached image pack could not be removed.', {packUrl});
        }
      }
    }

    const response = await fetch(packUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {Accept: 'application/octet-stream'},
    });
    const pack = await validatedPack(response, packUrl);
    await cache.put(
      packUrl,
      new Response(pack.bytes.slice(), {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Length': String(pack.bytes.byteLength),
          'Content-Type': 'application/octet-stream',
          'X-MRT-Pack-SHA256': pack.digest,
          'X-MRT-Stored-Bytes': String(pack.bytes.byteLength),
          'X-Content-Type-Options': 'nosniff',
        },
      }),
    );
    await prunePersistentPacks(cache);
    rememberPack(packUrl, pack);
    return pack;
  })().finally(() => {
    pendingPacks.delete(packUrl);
  });
  pendingPacks.set(packUrl, operation);
  return operation;
}

async function packedImageResponse(coordinate) {
  try {
    const pack = await loadPack(coordinate.packUrl);
    if (coordinate.offset + coordinate.length > pack.bytes.byteLength) {
      throw new Error(`Image coordinate exceeds its verified pack at ${coordinate.packUrl}.`);
    }
    const bytes = pack.bytes.slice(
      coordinate.offset,
      coordinate.offset + coordinate.length,
    );
    return new Response(bytes, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable, no-transform',
        'Content-Length': String(bytes.byteLength),
        'Content-Type': 'image/webp',
        'X-Content-Type-Options': 'nosniff',
        'X-MRT-Image-Pack-Cache': 'local',
      },
    });
  } catch (error) {
    console.error('A packed dataset image could not be reconstructed locally.', {
      packUrl: coordinate.packUrl,
      offset: coordinate.offset,
      length: coordinate.length,
      error,
    });
    return new Response('Dataset image unavailable', {
      status: 502,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const coordinate = packedCoordinate(url);
  if (coordinate) {
    event.respondWith(packedImageResponse(coordinate));
    return;
  }
  if (isImmutableContentRequest(url)) {
    event.respondWith(immutableContentResponse(event.request));
    return;
  }
  if (!url.pathname.startsWith(LOCAL_PACK_ROUTE_PREFIX)) return;

  event.respondWith(
    caches.open(LOCAL_PACK_CACHE).then(async cache => {
      // Export URLs carry an immutable dataset query for normal HTTP cache busting. Local pack
      // entries are already isolated by their content-addressed publication ID, so remove only the
      // query and perform an exact Cache API lookup. `ignoreSearch` may scan every entry in a large
      // cache and can stall once a pack contains tens of thousands of files.
      url.search = '';
      const response = await cache.match(url.href);
      return response ?? new Response('Local pack file not found.', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    }),
  );
});
