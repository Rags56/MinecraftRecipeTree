import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCoreDatasetIngestToken} from './upload-core-dataset-publication.mjs';

const DATASET_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTENT_ID_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UNSAFE_IDENTITY_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;
// The public catalog's edge cache is bounded to 60 seconds. A mutation purges the current POP,
// while these retries let verification outwait one already-populated entry in another POP without
// ever repeating the acknowledged mutation.
const POST_MUTATION_CATALOG_RETRY_DELAYS_MS = Object.freeze([
  200,
  500,
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
  32_000,
]);
const EXPECTED_PUBLICATION_HEADER = 'X-MRT-Expected-Dataset-Publication-ID';
const EXPECTED_PREVIEW_HEADER = 'X-MRT-Expected-Preview-Asset-Set-ID';
const DESCRIPTOR_KEYS = Object.freeze([
  'slug',
  'displayName',
  'minecraftVersion',
  'packVersion',
  'publicationId',
  'previewAssetSetId',
  'isDefault',
]);

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
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

function requireSlug(value) {
  if (typeof value !== 'string' || value.length > 80 || !DATASET_SLUG_PATTERN.test(value)) {
    throw new Error('slug must be a canonical lowercase-hyphen dataset identifier of 1-80 characters.');
  }
  return value;
}

function requireContentId(value, label) {
  if (typeof value !== 'string' || !CONTENT_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase 64-character SHA-256 identity.`);
  }
  return value;
}

function requireExpectedPreviousPublicationId(value) {
  if (value === null) return null;
  return requireContentId(value, 'expectedPreviousPublicationId');
}

function requireDescriptor(value, label = 'dataset descriptor') {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, DESCRIPTOR_KEYS) ||
    !boundedText(value.slug, 80) ||
    !DATASET_SLUG_PATTERN.test(value.slug) ||
    !boundedText(value.displayName, 120) ||
    !boundedText(value.minecraftVersion, 40) ||
    !boundedText(value.packVersion, 80) ||
    !CONTENT_ID_PATTERN.test(value.publicationId) ||
    !CONTENT_ID_PATTERN.test(value.previewAssetSetId) ||
    typeof value.isDefault !== 'boolean'
  ) {
    throw new Error(`${label} violates the exact public catalog contract.`);
  }
  return value;
}

function requireCatalog(value) {
  if (!isRecord(value) || !hasExactKeys(value, ['datasets']) || !Array.isArray(value.datasets)) {
    throw new Error('Dataset catalog response violates the exact top-level contract.');
  }
  if (value.datasets.length < 1 || value.datasets.length > 256) {
    throw new Error('Dataset catalog must contain between 1 and 256 channels.');
  }
  const datasets = value.datasets.map((entry, index) =>
    requireDescriptor(entry, `dataset catalog descriptor ${index}`),
  );
  for (const key of ['slug', 'publicationId', 'previewAssetSetId']) {
    if (new Set(datasets.map(dataset => dataset[key])).size !== datasets.length) {
      throw new Error(`Dataset catalog contains a duplicate ${key}.`);
    }
  }
  if (datasets.filter(dataset => dataset.isDefault).length !== 1) {
    throw new Error('Dataset catalog must expose exactly one default channel.');
  }
  return datasets;
}

function normalizeAdminBaseUrl(value, allowHttpForTests = false) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`adminBaseUrl must be an absolute URL: ${error.message}`);
  }
  if (url.protocol !== 'https:' && !(allowHttpForTests && url.protocol === 'http:')) {
    throw new Error(`Dataset channel administration requires HTTPS; received ${url.protocol}.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Dataset channel administration URL must not contain credentials, query parameters, or a fragment.',
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (url.pathname !== '/api/admin/dataset-channels') {
    throw new Error('adminBaseUrl must end at the exact /api/admin/dataset-channels route.');
  }
  return url;
}

function channelUrl(baseUrl, slug, suffix = '') {
  return new URL(`${baseUrl.pathname}/${encodeURIComponent(slug)}${suffix}`, baseUrl.origin);
}

function catalogUrl(baseUrl) {
  return new URL('/api/datasets', baseUrl.origin);
}

function redact(message, token) {
  let sanitized = String(message).replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  if (token) sanitized = sanitized.split(token).join('[REDACTED]');
  return sanitized;
}

async function cancelResponseBody(response, label) {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is cleanup rather than an alternate request path. Do not serialize the thrown
    // transport object because third-party implementations can embed Authorization headers in it.
    console.warn(`${label} response-body cancellation failed during fail-closed cleanup.`);
  }
}

async function readBoundedBytes(response) {
  const advertised = response.headers.get('content-length');
  if (advertised !== null) {
    if (!/^\d+$/.test(advertised) || Number(advertised) > MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response, 'Oversized dataset administration');
      throw new Error('Server response exceeded the bounded operator response contract.');
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Server response exceeded the bounded operator response contract.');
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
  return bytes;
}

async function requireJsonResponse(response, label) {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    await cancelResponseBody(response, label);
    throw new Error(`${label} returned an invalid Content-Type.`);
  }
  const cacheDirectives = (response.headers.get('cache-control') ?? '')
    .toLowerCase()
    .split(',')
    .map(value => value.trim());
  if (!cacheDirectives.includes('no-store')) {
    await cancelResponseBody(response, label);
    throw new Error(`${label} omitted the required Cache-Control: no-store directive.`);
  }
  const bytes = await readBoundedBytes(response);
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    throw new Error(`${label} returned invalid UTF-8 JSON.`);
  }
}

async function verifiedFetch({url, init, token, timeoutMs, fetchImpl, label}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(redact(`${label} transport failed: ${error?.message ?? error}`, token));
  }
  if (response.status !== 200) {
    await cancelResponseBody(response, label);
    throw new Error(`${label} returned unexpected HTTP ${response.status}.`);
  }
  return requireJsonResponse(response, label);
}

function requireTimeout(value) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer from 1 through ${MAX_TIMEOUT_MS}.`);
  }
  return timeoutMs;
}

function descriptorEquals(left, right) {
  return DESCRIPTOR_KEYS.every(key => left[key] === right[key]);
}

function defaultSleep(delayMs) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, delayMs));
}

export class DatasetChannelVerificationInconclusiveError extends Error {
  constructor(operation, slug, attempts, detail) {
    super(
      `Dataset channel ${operation} mutation committed; public catalog verification ` +
        `remained inconclusive after ${attempts} attempts: ${detail}`,
    );
    this.name = 'DatasetChannelVerificationInconclusiveError';
    this.code = 'DATASET_CHANNEL_MUTATION_COMMITTED_VERIFICATION_INCONCLUSIVE';
    this.mutationCommitted = true;
    this.operation = operation;
    this.slug = slug;
    this.attempts = attempts;
  }
}

async function verifyCommittedMutationInCatalog({
  operation,
  expected,
  baseUrl,
  token,
  timeoutMs,
  fetchImpl,
  sleepImpl,
  logger,
}) {
  const attempts = POST_MUTATION_CATALOG_RETRY_DELAYS_MS.length + 1;
  let lastFailure = 'no verification attempt completed';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) {
        await sleepImpl(POST_MUTATION_CATALOG_RETRY_DELAYS_MS[attempt - 2]);
      }
      const catalogValue = await verifiedFetch({
        url: catalogUrl(baseUrl),
        init: {method: 'GET', headers: {Accept: 'application/json'}},
        token,
        timeoutMs,
        fetchImpl,
        label: 'Post-operation dataset catalog verification',
      });
      const datasets = requireCatalog(catalogValue);
      const observed = datasets.find(dataset => dataset.slug === expected.slug);
      if (operation === 'activate') {
        if (!observed || !descriptorEquals(observed, expected)) {
          throw new Error(
            'Activated dataset channel was not visible with the exact requested catalog descriptor.',
          );
        }
        return observed;
      }
      if (observed) {
        throw new Error('Deactivated dataset channel remained visible in the public catalog.');
      }
      return {slug: expected.slug, deleted: true};
    } catch (error) {
      lastFailure = redact(error?.message ?? error, token);
      if (attempt < attempts) {
        logger.warn(
          `Dataset channel ${operation} mutation is committed, but public catalog verification ` +
            `attempt ${attempt}/${attempts} failed: ${lastFailure}; retrying in ` +
            `${POST_MUTATION_CATALOG_RETRY_DELAYS_MS[attempt - 1]} ms.`,
        );
      }
    }
  }
  throw new DatasetChannelVerificationInconclusiveError(
    operation,
    expected.slug,
    attempts,
    lastFailure,
  );
}

export async function administerDatasetChannel({
  operation,
  slug,
  displayName,
  minecraftVersion,
  packVersion,
  publicationId,
  previewAssetSetId,
  isDefault,
  expectedPreviousPublicationId,
  adminBaseUrl,
  token,
  timeoutMs,
  fetchImpl = fetch,
  logger = console,
  sleepImpl = defaultSleep,
  allowHttpForTests = false,
}) {
  const validatedSlug = requireSlug(slug);
  const baseUrl = normalizeAdminBaseUrl(adminBaseUrl, allowHttpForTests);
  const boundedTimeout = requireTimeout(timeoutMs);
  if (
    typeof token !== 'string' ||
    token.length < 32 ||
    Buffer.byteLength(token) > 8192 ||
    /[\s\u0000-\u001f\u007f]/.test(token)
  ) {
    throw new Error('Dataset channel bearer token violates the strict 32-8192 byte format.');
  }
  if (
    !logger ||
    !['info', 'warn', 'error'].every(name => typeof logger[name] === 'function') ||
    typeof sleepImpl !== 'function'
  ) {
    throw new Error('logger must provide info/warn/error and sleepImpl must be a function.');
  }
  const authorization = `Bearer ${token}`;
  let mutationCommitted = false;

  try {
    let expected;
    if (operation === 'activate') {
      const expectedPrevious = requireExpectedPreviousPublicationId(expectedPreviousPublicationId);
      const descriptor = requireDescriptor({
        slug: validatedSlug,
        displayName,
        minecraftVersion,
        packVersion,
        publicationId: requireContentId(publicationId, 'publicationId'),
        previewAssetSetId: requireContentId(previewAssetSetId, 'previewAssetSetId'),
        isDefault,
      });
      const body = JSON.stringify({
        displayName: descriptor.displayName,
        minecraftVersion: descriptor.minecraftVersion,
        packVersion: descriptor.packVersion,
        publicationId: descriptor.publicationId,
        previewAssetSetId: descriptor.previewAssetSetId,
        isDefault: descriptor.isDefault,
        expectedPreviousPublicationId: expectedPrevious,
      });
      const value = await verifiedFetch({
        url: channelUrl(baseUrl, validatedSlug, '/activate'),
        init: {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Length': String(Buffer.byteLength(body)),
            'Content-Type': 'application/json',
          },
          body,
        },
        token,
        timeoutMs: boundedTimeout,
        fetchImpl,
        label: 'Dataset channel activation',
      });
      if (!isRecord(value) || !hasExactKeys(value, ['dataset'])) {
        throw new Error('Dataset channel activation returned an invalid top-level contract.');
      }
      const returned = requireDescriptor(value.dataset, 'activated dataset descriptor');
      if (!descriptorEquals(returned, descriptor)) {
        throw new Error('Dataset channel activation response does not match the requested descriptor.');
      }
      expected = descriptor;
    } else if (operation === 'deactivate') {
      const expectedPublicationId = requireContentId(publicationId, 'publicationId');
      const expectedPreviewAssetSetId = requireContentId(previewAssetSetId, 'previewAssetSetId');
      const value = await verifiedFetch({
        url: channelUrl(baseUrl, validatedSlug),
        init: {
          method: 'DELETE',
          headers: {
            Authorization: authorization,
            'Content-Length': '0',
            [EXPECTED_PUBLICATION_HEADER]: expectedPublicationId,
            [EXPECTED_PREVIEW_HEADER]: expectedPreviewAssetSetId,
          },
        },
        token,
        timeoutMs: boundedTimeout,
        fetchImpl,
        label: 'Dataset channel deactivation',
      });
      if (
        !isRecord(value) ||
        !hasExactKeys(value, ['deleted']) ||
        !isRecord(value.deleted) ||
        !hasExactKeys(value.deleted, ['slug', 'publicationId', 'previewAssetSetId']) ||
        value.deleted.slug !== validatedSlug ||
        value.deleted.publicationId !== expectedPublicationId ||
        value.deleted.previewAssetSetId !== expectedPreviewAssetSetId
      ) {
        throw new Error('Dataset channel deactivation returned an invalid deletion receipt.');
      }
      expected = {
        slug: validatedSlug,
        publicationId: expectedPublicationId,
        previewAssetSetId: expectedPreviewAssetSetId,
      };
    } else {
      throw new Error('operation must be exactly activate or deactivate.');
    }
    mutationCommitted = true;
    const verified = await verifyCommittedMutationInCatalog({
      operation,
      expected,
      baseUrl,
      token,
      timeoutMs: boundedTimeout,
      fetchImpl,
      sleepImpl,
      logger,
    });
    if (operation === 'activate') {
      logger.info(`Dataset channel ${validatedSlug} activated and independently verified in the public catalog.`);
      return verified;
    }
    logger.info(`Dataset channel ${validatedSlug} deactivated and independently verified absent from the public catalog.`);
    return verified;
  } catch (error) {
    const message = redact(error?.message ?? error, token);
    if (mutationCommitted) {
      logger.error(message);
      if (error instanceof DatasetChannelVerificationInconclusiveError) throw error;
      throw new DatasetChannelVerificationInconclusiveError(operation, validatedSlug, 0, message);
    }
    logger.error(
      `Dataset channel ${operation} did not return a committed mutation receipt; ` +
        `no catalog state was assumed: ${message}`,
    );
    throw new Error(message);
  }
}

function parseBoolean(value, flag) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} must be exactly true or false.`);
}

export function parseDatasetChannelCliArguments(argv) {
  const [operation, ...argumentsAfterOperation] = argv;
  if (operation !== 'activate' && operation !== 'deactivate') {
    throw new Error('The first argument must be exactly activate or deactivate.');
  }
  const names = new Map([
    ['--slug', 'slug'],
    ['--display-name', 'displayName'],
    ['--minecraft-version', 'minecraftVersion'],
    ['--pack-version', 'packVersion'],
    ['--publication-id', 'publicationId'],
    ['--preview-asset-set-id', 'previewAssetSetId'],
    ['--default', 'isDefault'],
    ['--expected-previous-publication-id', 'expectedPreviousPublicationId'],
    ['--admin-base-url', 'adminBaseUrl'],
    ['--token-file', 'tokenFile'],
    ['--timeout-ms', 'timeoutMs'],
  ]);
  const options = {operation};
  for (let index = 0; index < argumentsAfterOperation.length; index += 1) {
    const flag = argumentsAfterOperation[index];
    const name = names.get(flag);
    if (!name) throw new Error(`Unknown dataset channel administrator argument: ${flag}.`);
    const value = argumentsAfterOperation[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (options[name] !== undefined) throw new Error(`${flag} was provided more than once.`);
    options[name] = name === 'isDefault'
      ? parseBoolean(value, flag)
      : name === 'timeoutMs'
        ? Number(value)
        : name === 'expectedPreviousPublicationId' && value === 'absent'
          ? null
          : value;
    index += 1;
  }
  const required = operation === 'activate'
    ? ['slug', 'displayName', 'minecraftVersion', 'packVersion', 'publicationId', 'previewAssetSetId', 'isDefault', 'expectedPreviousPublicationId', 'adminBaseUrl']
    : ['slug', 'publicationId', 'previewAssetSetId', 'adminBaseUrl'];
  const missing = required.filter(name => options[name] === undefined);
  if (missing.length > 0) throw new Error(`Missing required dataset channel arguments: ${missing.join(', ')}.`);
  const activationOnly = [
    'displayName',
    'minecraftVersion',
    'packVersion',
    'isDefault',
    'expectedPreviousPublicationId',
  ];
  if (operation === 'deactivate' && activationOnly.some(name => options[name] !== undefined)) {
    throw new Error('Deactivation refuses activation-only descriptor arguments.');
  }
  return options;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseDatasetChannelCliArguments(process.argv.slice(2));
    options.token = await readCoreDatasetIngestToken({tokenFile: options.tokenFile});
    delete options.tokenFile;
    await administerDatasetChannel(options);
  } catch (error) {
    if (error?.mutationCommitted === true) {
      console.error(`Dataset channel administrator terminated after a committed mutation: ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(`Dataset channel administrator terminated without a committed receipt: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
