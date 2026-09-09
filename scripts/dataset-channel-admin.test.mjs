import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DatasetChannelVerificationInconclusiveError,
  administerDatasetChannel,
  parseDatasetChannelCliArguments,
} from './dataset-channel-admin.mjs';

const ADMIN_BASE_URL = 'http://operator.example/api/admin/dataset-channels';
const TOKEN = 'dataset-channel-administrator-token-'.padEnd(48, 'x');
const PUBLICATION = 'a'.repeat(64);
const PREVIEW = 'b'.repeat(64);
const DEFAULT_DATASET = Object.freeze({
  slug: 'meatballcraft',
  displayName: 'MeatballCraft',
  minecraftVersion: '1.12.2',
  packVersion: '0.18.5-hotfix2',
  publicationId: 'c'.repeat(64),
  previewAssetSetId: 'd'.repeat(64),
  isDefault: true,
});
const MULTIBLOCK = Object.freeze({
  slug: 'multiblock-madness',
  displayName: 'Multiblock Madness',
  minecraftVersion: '1.12.2',
  packVersion: '3.2.3',
  publicationId: PUBLICATION,
  previewAssetSetId: PREVIEW,
  isDefault: false,
});

function jsonResponse(value, status = 200) {
  return new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: {'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8'},
  });
}

function silentLogger() {
  return {info() {}, warn() {}, error() {}};
}

async function noDelay() {}

test('activation sends the exact authenticated descriptor then independently verifies the catalog', async () => {
  const calls = [];
  const result = await administerDatasetChannel({
    operation: 'activate',
    ...MULTIBLOCK,
    expectedPreviousPublicationId: null,
    adminBaseUrl: ADMIN_BASE_URL,
    token: TOKEN,
    allowHttpForTests: true,
    logger: silentLogger(),
    async fetchImpl(url, init) {
      calls.push({url: String(url), init});
      if (calls.length === 1) return jsonResponse({dataset: MULTIBLOCK});
      return jsonResponse({datasets: [DEFAULT_DATASET, MULTIBLOCK]});
    },
  });
  assert.deepEqual(result, MULTIBLOCK);
  assert.equal(
    calls[0].url,
    `${ADMIN_BASE_URL}/multiblock-madness/activate`,
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(
    calls[0].init.headers['Content-Length'],
    String(Buffer.byteLength(calls[0].init.body)),
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    displayName: MULTIBLOCK.displayName,
    minecraftVersion: MULTIBLOCK.minecraftVersion,
    packVersion: MULTIBLOCK.packVersion,
    publicationId: MULTIBLOCK.publicationId,
    previewAssetSetId: MULTIBLOCK.previewAssetSetId,
    isDefault: false,
    expectedPreviousPublicationId: null,
  });
  assert.equal(calls[1].url, 'http://operator.example/api/datasets');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.headers.Authorization, undefined);
});

test('channel administration counts identity bounds in Unicode code points', async () => {
  const astralName = '🧱'.repeat(120);
  const descriptor = {...MULTIBLOCK, displayName: astralName};
  const result = await administerDatasetChannel({
    operation: 'activate',
    ...descriptor,
    expectedPreviousPublicationId: null,
    adminBaseUrl: ADMIN_BASE_URL,
    token: TOKEN,
    allowHttpForTests: true,
    logger: silentLogger(),
    async fetchImpl(_url, init) {
      return init.method === 'POST'
        ? jsonResponse({dataset: descriptor})
        : jsonResponse({datasets: [DEFAULT_DATASET, descriptor]});
    },
  });
  assert.equal(result.displayName, astralName);
  await assert.rejects(
    administerDatasetChannel({
      operation: 'activate',
      ...MULTIBLOCK,
      displayName: 'Unsafe\u202eName',
      expectedPreviousPublicationId: null,
      adminBaseUrl: ADMIN_BASE_URL,
      token: TOKEN,
      allowHttpForTests: true,
      logger: silentLogger(),
      async fetchImpl() {
        throw new Error('invalid identity must be rejected before transport');
      },
    }),
    /descriptor violates/,
  );
});

test('activation retries bounded stale catalog reads and succeeds without repeating the mutation', async () => {
  const calls = [];
  const delays = [];
  const warnings = [];
  const result = await administerDatasetChannel({
    operation: 'activate',
    ...MULTIBLOCK,
    expectedPreviousPublicationId: MULTIBLOCK.publicationId,
    adminBaseUrl: ADMIN_BASE_URL,
    token: TOKEN,
    allowHttpForTests: true,
    logger: {info() {}, warn(message) { warnings.push(message); }, error() {}},
    async sleepImpl(delay) { delays.push(delay); },
    async fetchImpl(url, init) {
      calls.push({url: String(url), init});
      if (calls.length === 1) return jsonResponse({dataset: MULTIBLOCK});
      return calls.length < 4
        ? jsonResponse({datasets: [DEFAULT_DATASET]})
        : jsonResponse({datasets: [DEFAULT_DATASET, MULTIBLOCK]});
    },
  });
  assert.deepEqual(result, MULTIBLOCK);
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.init.method === 'GET').length, 3);
  assert.deepEqual(delays, [200, 500]);
  assert.equal(warnings.length, 2);
});

test('activation reports a committed mutation with inconclusive verification after bounded retries', async () => {
  let calls = 0;
  const logged = [];
  await assert.rejects(
    administerDatasetChannel({
      operation: 'activate',
      ...MULTIBLOCK,
      expectedPreviousPublicationId: null,
      adminBaseUrl: ADMIN_BASE_URL,
      token: TOKEN,
      allowHttpForTests: true,
      sleepImpl: noDelay,
      logger: {info() {}, warn() {}, error(message) { logged.push(message); }},
      async fetchImpl() {
        calls += 1;
        return calls === 1
          ? jsonResponse({dataset: MULTIBLOCK})
          : jsonResponse({datasets: [DEFAULT_DATASET]});
      },
    }),
    error => {
      assert.ok(error instanceof DatasetChannelVerificationInconclusiveError);
      assert.equal(error.mutationCommitted, true);
      assert.equal(error.code, 'DATASET_CHANNEL_MUTATION_COMMITTED_VERIFICATION_INCONCLUSIVE');
      assert.equal(error.attempts, 9);
      assert.match(error.message, /mutation committed.*inconclusive after 9 attempts/i);
      return true;
    },
  );
  assert.equal(calls, 10);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /mutation committed/i);
});

test('deactivation uses an authenticated empty DELETE and verifies catalog absence', async () => {
  const calls = [];
  const result = await administerDatasetChannel({
    operation: 'deactivate',
    slug: MULTIBLOCK.slug,
    publicationId: MULTIBLOCK.publicationId,
    previewAssetSetId: MULTIBLOCK.previewAssetSetId,
    adminBaseUrl: ADMIN_BASE_URL,
    token: TOKEN,
    allowHttpForTests: true,
    logger: silentLogger(),
    async fetchImpl(url, init) {
      calls.push({url: String(url), init});
      return calls.length === 1
        ? jsonResponse({
            deleted: {
              slug: MULTIBLOCK.slug,
              publicationId: MULTIBLOCK.publicationId,
              previewAssetSetId: MULTIBLOCK.previewAssetSetId,
            },
          })
        : jsonResponse({datasets: [DEFAULT_DATASET]});
    },
  });
  assert.deepEqual(result, {slug: MULTIBLOCK.slug, deleted: true});
  assert.equal(calls[0].url, `${ADMIN_BASE_URL}/multiblock-madness`);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].init.headers['Content-Length'], '0');
  assert.equal(
    calls[0].init.headers['X-MRT-Expected-Dataset-Publication-ID'],
    MULTIBLOCK.publicationId,
  );
  assert.equal(
    calls[0].init.headers['X-MRT-Expected-Preview-Asset-Set-ID'],
    MULTIBLOCK.previewAssetSetId,
  );
  assert.equal(calls[0].init.body, undefined);
});

test('transport failures redact the bearer token from errors and logs', async () => {
  const logged = [];
  await assert.rejects(
    administerDatasetChannel({
      operation: 'deactivate',
      slug: MULTIBLOCK.slug,
      publicationId: MULTIBLOCK.publicationId,
      previewAssetSetId: MULTIBLOCK.previewAssetSetId,
      adminBaseUrl: ADMIN_BASE_URL,
      token: TOKEN,
      allowHttpForTests: true,
      logger: {info() {}, warn() {}, error(message) { logged.push(message); }},
      async fetchImpl() {
        throw new Error(`request leaked Authorization: Bearer ${TOKEN}`);
      },
    }),
    error => {
      assert.doesNotMatch(error.message, new RegExp(TOKEN));
      assert.match(error.message, /\[REDACTED\]/);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  assert.doesNotMatch(JSON.stringify(logged), new RegExp(TOKEN));
});

test('CLI parsing is exact and deactivation refuses descriptor arguments', () => {
  assert.deepEqual(
    parseDatasetChannelCliArguments([
      'activate',
      '--slug',
      'multiblock-madness',
      '--display-name',
      'Multiblock Madness',
      '--minecraft-version',
      '1.12.2',
      '--pack-version',
      '3.2.3',
      '--publication-id',
      PUBLICATION,
      '--preview-asset-set-id',
      PREVIEW,
      '--default',
      'false',
      '--expected-previous-publication-id',
      'absent',
      '--admin-base-url',
      'https://viewer.example/api/admin/dataset-channels',
    ]),
    {
      operation: 'activate',
      slug: 'multiblock-madness',
      displayName: 'Multiblock Madness',
      minecraftVersion: '1.12.2',
      packVersion: '3.2.3',
      publicationId: PUBLICATION,
      previewAssetSetId: PREVIEW,
      isDefault: false,
      expectedPreviousPublicationId: null,
      adminBaseUrl: 'https://viewer.example/api/admin/dataset-channels',
    },
  );
  assert.deepEqual(
    parseDatasetChannelCliArguments([
      'deactivate',
      '--slug',
      'multiblock-madness',
      '--publication-id',
      PUBLICATION,
      '--preview-asset-set-id',
      PREVIEW,
      '--admin-base-url',
      'https://viewer.example/api/admin/dataset-channels',
      '--token-file',
      '/private/operator-token',
    ]),
    {
      operation: 'deactivate',
      slug: 'multiblock-madness',
      publicationId: PUBLICATION,
      previewAssetSetId: PREVIEW,
      adminBaseUrl: 'https://viewer.example/api/admin/dataset-channels',
      tokenFile: '/private/operator-token',
    },
  );
  assert.throws(
    () => parseDatasetChannelCliArguments([
      'activate', '--slug', 'multiblock-madness', '--display-name', 'Multiblock Madness',
      '--minecraft-version', '1.12.2', '--pack-version', '3.2.3',
      '--publication-id', PUBLICATION, '--preview-asset-set-id', PREVIEW,
      '--default', 'false',
      '--admin-base-url', 'https://viewer.example/api/admin/dataset-channels',
    ]),
    /expectedPreviousPublicationId/,
  );
  assert.throws(
    () => parseDatasetChannelCliArguments([
      'deactivate', '--slug', 'multiblock-madness', '--publication-id', PUBLICATION,
      '--preview-asset-set-id', PREVIEW, '--display-name', 'ignored',
      '--admin-base-url', 'https://viewer.example/api/admin/dataset-channels',
    ]),
    /refuses activation-only/,
  );
});
