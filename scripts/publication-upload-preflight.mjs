const CONTENT_ID_PATTERN = /^[a-f0-9]{64}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTOR_KEYS = Object.freeze([
  'displayName',
  'isDefault',
  'minecraftVersion',
  'packVersion',
  'previewAssetSetId',
  'publicationId',
  'slug',
]);
const MAX_CATALOG_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const PUBLICATION_ID_HEADER = 'x-mrt-dataset-publication-id';
const PUBLICATION_STATE_HEADER = 'x-mrt-publication-state';
const UNSAFE_IDENTITY_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedText(value, maximum) {
  return (
    typeof value === 'string' &&
    [...value].length > 0 &&
    [...value].length <= maximum &&
    value.trim() === value &&
    !UNSAFE_IDENTITY_TEXT_PATTERN.test(value)
  );
}

function requireContentId(value, label) {
  if (typeof value !== 'string' || !CONTENT_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase 64-character SHA-256 identity.`);
  }
  return value;
}

function requireHttpsOrigin(value, allowHttpForTests = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Publishing preflight requires an absolute HTTPS origin.');
  }
  if (
    (url.protocol !== 'https:' && !(allowHttpForTests && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Publishing preflight requires an absolute HTTPS origin without a path or credentials.');
  }
  return url.origin;
}

function requireTimeout(value) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer in [1, ${MAX_TIMEOUT_MS}].`);
  }
  return timeoutMs;
}

function requireDescriptor(value, index) {
  if (
    !exactKeys(value, DESCRIPTOR_KEYS) ||
    typeof value.slug !== 'string' ||
    value.slug.length > 80 ||
    !SLUG_PATTERN.test(value.slug) ||
    !boundedText(value.displayName, 120) ||
    !boundedText(value.minecraftVersion, 40) ||
    !boundedText(value.packVersion, 80) ||
    !CONTENT_ID_PATTERN.test(value.publicationId) ||
    !CONTENT_ID_PATTERN.test(value.previewAssetSetId) ||
    typeof value.isDefault !== 'boolean'
  ) {
    throw new Error(`Publishing catalog descriptor ${index} violates the exact contract.`);
  }
  return value;
}

export function requirePublishingCatalog(value) {
  if (!exactKeys(value, ['datasets']) || !Array.isArray(value.datasets)) {
    throw new Error('Publishing catalog must be an exact object containing a datasets array.');
  }
  if (value.datasets.length < 1 || value.datasets.length > 256) {
    throw new Error('Publishing catalog must contain between 1 and 256 datasets.');
  }
  const datasets = value.datasets.map(requireDescriptor);
  for (const key of ['slug', 'publicationId', 'previewAssetSetId']) {
    if (new Set(datasets.map(dataset => dataset[key])).size !== datasets.length) {
      throw new Error(`Publishing catalog contains a duplicate ${key}.`);
    }
  }
  if (datasets.filter(dataset => dataset.isDefault).length !== 1) {
    throw new Error('Publishing catalog must expose exactly one default dataset.');
  }
  return datasets;
}

async function cancelBody(response, label) {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    console.warn(`${label} response-body cancellation failed during bounded cleanup.`);
  }
}

async function readBoundedJson(response, label) {
  const advertised = response.headers.get('content-length');
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_CATALOG_BYTES)) {
    await cancelBody(response, label);
    throw new Error(`${label} exceeded the ${MAX_CATALOG_BYTES}-byte response limit.`);
  }
  if (!response.body) throw new Error(`${label} returned an empty response.`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CATALOG_BYTES) {
        await reader.cancel();
        throw new Error(`${label} exceeded the ${MAX_CATALOG_BYTES}-byte response limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    throw new Error(`${label} returned invalid UTF-8 JSON.`);
  }
}

export async function fetchPublishingCatalog({
  appOrigin,
  fetchImpl = fetch,
  timeoutMs,
  allowHttpForTests = false,
}) {
  const origin = requireHttpsOrigin(appOrigin, allowHttpForTests);
  const boundedTimeout = requireTimeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${origin}/api/datasets`, {
      method: 'GET',
      headers: {Accept: 'application/json'},
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(boundedTimeout),
    });
  } catch {
    throw new Error('Publishing catalog transport failed; no channel state was assumed.');
  }
  if (response.status !== 200) {
    await cancelBody(response, 'Publishing catalog');
    throw new Error(`Publishing catalog returned unexpected HTTP ${response.status}.`);
  }
  if (!noStore(response)) {
    await cancelBody(response, 'Publishing catalog');
    throw new Error('Publishing catalog omitted the required Cache-Control: no-store directive.');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    await cancelBody(response, 'Publishing catalog');
    throw new Error('Publishing catalog returned an invalid Content-Type.');
  }
  return requirePublishingCatalog(await readBoundedJson(response, 'Publishing catalog'));
}

/**
 * Convert an operator's explicit create/update intent into the CAS precondition sent to D1.
 * The current public descriptor is never silently treated as authorization to update a channel.
 */
export function resolveChannelExpectation({datasets, action, plan}) {
  if (action !== 'create' && action !== 'update') {
    throw new Error('channelAction must be exactly create or update.');
  }
  const validated = requirePublishingCatalog({datasets});
  const current = validated.find(dataset => dataset.slug === plan?.slug) ?? null;
  if (action === 'create') {
    if (current) {
      throw new Error(
        `Channel ${plan.slug} already exists at publication ${current.publicationId}; ` +
          'use an explicit update action after reviewing the current pack.',
      );
    }
    return Object.freeze({expectedPreviousPublicationId: null, current: null});
  }
  if (!current) {
    throw new Error(`Channel ${String(plan?.slug)} does not exist; an update cannot create it.`);
  }
  if (current.displayName !== plan?.pack?.name || current.minecraftVersion !== plan?.minecraftVersion) {
    throw new Error(
      `Channel ${current.slug} belongs to ${current.displayName} on Minecraft ` +
        `${current.minecraftVersion}; it cannot be updated by ${String(plan?.pack?.name)} on ` +
        `${String(plan?.minecraftVersion)}.`,
    );
  }
  if (current.publicationId === plan?.publicationId) {
    throw new Error(`Channel ${current.slug} already points to this exact publication.`);
  }
  return Object.freeze({expectedPreviousPublicationId: current.publicationId, current});
}

function noStore(response) {
  return (response.headers.get('cache-control') ?? '')
    .toLowerCase()
    .split(',')
    .map(value => value.trim())
    .includes('no-store');
}

async function requireIngestionStatus(response, {label, publicationId}) {
  if (!noStore(response)) {
    await cancelBody(response, label);
    throw new Error(`${label} omitted the required Cache-Control: no-store directive.`);
  }
  if (response.status === 404) {
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    await cancelBody(response, label);
    if (contentType !== null || (contentLength !== null && contentLength !== '0')) {
      throw new Error(`${label} returned a configured-target error instead of an empty status.`);
    }
    return 'absent';
  }
  if (response.status !== 200) {
    await cancelBody(response, label);
    throw new Error(`${label} returned unexpected HTTP ${response.status}.`);
  }
  if (
    response.headers.get(PUBLICATION_ID_HEADER) !== publicationId ||
    !['staged', 'committed'].includes(response.headers.get(PUBLICATION_STATE_HEADER))
  ) {
    await cancelBody(response, label);
    throw new Error(`${label} returned conflicting publication identity/state headers.`);
  }
  await cancelBody(response, label);
  return response.headers.get(PUBLICATION_STATE_HEADER);
}

async function ingestionHead({url, headers, timeoutMs, fetchImpl, label, publicationId}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'HEAD',
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`${label} transport failed; no bulk upload was started.`);
  }
  return requireIngestionStatus(response, {label, publicationId});
}

/** Authenticate and validate both scoped ingestion targets before either multi-GiB upload starts. */
export async function preflightIngestionEndpoints({
  appOrigin,
  publicationId,
  previewAssetSetId,
  coreToken,
  previewToken,
  fetchImpl = fetch,
  timeoutMs,
  allowHttpForTests = false,
  logger = console,
}) {
  const origin = requireHttpsOrigin(appOrigin, allowHttpForTests);
  const boundedTimeout = requireTimeout(timeoutMs);
  const publication = requireContentId(publicationId, 'publicationId');
  const preview = requireContentId(previewAssetSetId, 'previewAssetSetId');
  if (typeof coreToken !== 'string' || typeof previewToken !== 'string') {
    throw new Error('Ingestion preflight requires validated core and preview bearer tokens.');
  }
  logger.info('[publish-modpack] Preflighting both authenticated ingestion targets before upload.');
  const [coreState, previewState] = await Promise.all([
    ingestionHead({
      url: `${origin}/api/admin/core-datasets/status`,
      headers: {
        Authorization: `Bearer ${coreToken}`,
        'X-MRT-Dataset-Publication-ID': publication,
      },
      timeoutMs: boundedTimeout,
      fetchImpl,
      label: 'Core ingestion preflight',
      publicationId: publication,
    }),
    ingestionHead({
      url: `${origin}/api/admin/preview-assets/${preview}/status`,
      headers: {Authorization: `Bearer ${previewToken}`},
      timeoutMs: boundedTimeout,
      fetchImpl,
      label: 'Preview ingestion preflight',
      publicationId: publication,
    }),
  ]);
  logger.info(
    `[publish-modpack] Ingestion preflight passed (core=${coreState}, preview=${previewState}).`,
  );
  return Object.freeze({coreState, previewState});
}
