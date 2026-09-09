import {CORE_DATASET_PUBLICATION_ID_PATTERN} from './coreDatasetContract.ts';
import {
  type CommittedDatasetIdentity,
  requireExactGtnhActivationBinding,
} from './datasetIdentity.ts';
import {
  authorizeDatasetAdmin,
  type D1Database,
  type DatasetRuntime,
  methodNotAllowed,
  noStoreJson,
} from './datasetRuntime.ts';

export const DATASET_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DATASET_CHANNEL_ACTIVATION_ROUTE =
  /^\/api\/admin\/dataset-channels\/([a-z0-9]+(?:-[a-z0-9]+)*)\/activate$/;
export const DATASET_CHANNEL_DELETION_ROUTE =
  /^\/api\/admin\/dataset-channels\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const EXPECTED_PUBLICATION_HEADER = 'x-mrt-expected-dataset-publication-id';
const EXPECTED_PREVIEW_HEADER = 'x-mrt-expected-preview-asset-set-id';
const UNSAFE_IDENTITY_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;
export const DATASET_CATALOG_EDGE_TTL_SECONDS = 60;
let catalogCacheUnavailableReported = false;

const createPublicationsTableSql = `
  CREATE TABLE IF NOT EXISTS dataset_publications (
    publication_id TEXT PRIMARY KEY NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    object_count INTEGER NOT NULL,
    stored_bytes INTEGER NOT NULL,
    committed_at INTEGER NOT NULL
  )
`;

const createChannelsTableSql = `
  CREATE TABLE IF NOT EXISTS dataset_channels (
    slug TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    minecraft_version TEXT NOT NULL,
    pack_version TEXT NOT NULL,
    publication_id TEXT NOT NULL,
    preview_asset_set_id TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    activated_at INTEGER NOT NULL,
    FOREIGN KEY (publication_id) REFERENCES dataset_publications(publication_id)
  )
`;

const createDefaultIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS dataset_channels_one_default_idx
  ON dataset_channels (is_default) WHERE is_default = 1
`;

const createPublicationIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS dataset_channels_publication_idx
  ON dataset_channels (publication_id)
`;

const createPreviewIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS dataset_channels_preview_asset_set_idx
  ON dataset_channels (preview_asset_set_id)
`;

const initializedDatabases = new WeakMap<object, Promise<void>>();

/**
 * Tests and local Workers may start with an empty D1. Production applies the same checked-in
 * migration; this idempotent initialization keeps route behavior explicit in either environment.
 */
export function ensureDatasetSchema(db: D1Database): Promise<void> {
  const cached = initializedDatabases.get(db as object);
  if (cached) return cached;
  const operation = db
    .batch([
      db.prepare(createPublicationsTableSql),
      db.prepare(createChannelsTableSql),
      db.prepare(createDefaultIndexSql),
      db.prepare(createPublicationIndexSql),
      db.prepare(createPreviewIndexSql),
    ])
    .then(results => {
      if (results.some(result => !result.success)) {
        throw new Error('D1 reported an unsuccessful dataset schema statement.');
      }
    })
    .catch(error => {
      initializedDatabases.delete(db as object);
      console.error('Dataset registry schema initialization failed.', error);
      throw error;
    });
  initializedDatabases.set(db as object, operation);
  return operation;
}

export interface DatasetDescriptor {
  slug: string;
  displayName: string;
  minecraftVersion: string;
  packVersion: string;
  publicationId: string;
  previewAssetSetId: string;
  isDefault: boolean;
}

interface DatasetChannelRow {
  slug: string;
  display_name: string;
  minecraft_version: string;
  pack_version: string;
  publication_id: string;
  preview_asset_set_id: string;
  is_default: number;
}

function descriptorFromRow(row: DatasetChannelRow): DatasetDescriptor {
  if (
    !DATASET_SLUG_PATTERN.test(row.slug) ||
    row.slug.length > 80 ||
    !boundedText(row.display_name, 120) ||
    !boundedText(row.minecraft_version, 40) ||
    !boundedText(row.pack_version, 80) ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(row.publication_id) ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(row.preview_asset_set_id) ||
    (row.is_default !== 0 && row.is_default !== 1)
  ) {
    throw new Error(`Dataset channel ${JSON.stringify(row.slug)} contains invalid persisted data.`);
  }
  return {
    slug: row.slug,
    displayName: row.display_name,
    minecraftVersion: row.minecraft_version,
    packVersion: row.pack_version,
    publicationId: row.publication_id,
    previewAssetSetId: row.preview_asset_set_id,
    isDefault: row.is_default === 1,
  };
}

/** A fixed, query-string-free key for this hostname's edge-local catalog entry. */
function catalogCacheKey(request: Request): Request {
  return new Request(new URL('/api/datasets', request.url).toString(), {method: 'GET'});
}

function defaultCatalogCache(context: string): Cache | null {
  try {
    const cache = caches.default;
    catalogCacheUnavailableReported = false;
    return cache;
  } catch (error) {
    if (!catalogCacheUnavailableReported) {
      catalogCacheUnavailableReported = true;
      console.warn('Dataset catalog edge cache is unavailable; continuing against D1.', {
        context,
        error,
      });
    }
    return null;
  }
}

async function invalidateCatalogCache(request: Request, context: string): Promise<void> {
  const cache = defaultCatalogCache(context);
  if (!cache) return;
  try {
    await cache.delete(catalogCacheKey(request));
  } catch (error) {
    console.warn(
      'Could not invalidate the local dataset catalog edge entry; other entries remain bounded by the configured TTL.',
      {context, ttlSeconds: DATASET_CATALOG_EDGE_TTL_SECONDS, error},
    );
  }
}

async function readCachedCatalog(request: Request, cache: Cache | null): Promise<Response | null> {
  if (!cache) return null;
  try {
    const cached = await cache.match(catalogCacheKey(request));
    if (!cached) return null;
    const headers = new Headers(cached.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  } catch (error) {
    console.warn('Dataset catalog edge-cache lookup failed; continuing against D1.', {error});
    return null;
  }
}

async function cacheCatalog(request: Request, body: string, cache: Cache | null): Promise<void> {
  if (!cache) return;
  const cachedResponse = new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': `public, max-age=${DATASET_CATALOG_EDGE_TTL_SECONDS}`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  try {
    await cache.put(catalogCacheKey(request), cachedResponse);
  } catch (error) {
    console.warn('Dataset catalog edge-cache fill failed; returning the fresh D1 result.', {error});
  }
}

export async function handleDatasetCatalog(
  request: Request,
  runtime: DatasetRuntime,
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const cache = defaultCatalogCache('catalog request');
  const cached = await readCachedCatalog(request, cache);
  if (cached) return cached;
  const db = runtime.DB;
  if (!db) {
    console.error('Dataset catalog cannot read because the DB binding is unavailable.');
    return noStoreJson({error: 'Dataset catalog storage is unavailable.'}, 503);
  }
  try {
    await ensureDatasetSchema(db);
    const result = await db
      .prepare(
        `SELECT c.slug, c.display_name, c.minecraft_version, c.pack_version,
                c.publication_id, c.preview_asset_set_id, c.is_default
         FROM dataset_channels c
         INNER JOIN dataset_publications p ON p.publication_id = c.publication_id
         ORDER BY c.is_default DESC, c.display_name COLLATE NOCASE ASC, c.slug ASC`,
      )
      .all<DatasetChannelRow>();
    if (!result.success) throw new Error('D1 reported an unsuccessful catalog query.');
    const datasets = (result.results ?? []).map(descriptorFromRow);
    const defaults = datasets.filter(dataset => dataset.isDefault);
    if (datasets.length === 0 || defaults.length !== 1) {
      console.error('Dataset catalog is not publishable because its default-channel invariant failed.', {
        channels: datasets.length,
        defaults: defaults.length,
      });
      return noStoreJson({error: 'Dataset catalog is not configured.'}, 503);
    }
    // Cache API entries are edge-local, so mutations eagerly clear their local entry while this
    // short TTL bounds visibility elsewhere. Callers always receive no-store because publishing
    // and channel-verification clients must independently observe the public Worker response.
    const body = `${JSON.stringify({datasets})}\n`;
    await cacheCatalog(request, body, cache);
    return new Response(body, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Dataset catalog query failed.', error);
    return noStoreJson({error: 'Dataset catalog is unavailable.'}, 503);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    [...value].length > 0 &&
    [...value].length <= maximum &&
    value.trim() === value &&
    !UNSAFE_IDENTITY_TEXT_PATTERN.test(value)
  );
}

interface ActivationInput {
  displayName: string;
  minecraftVersion: string;
  packVersion: string;
  publicationId: string;
  previewAssetSetId: string;
  isDefault: boolean;
  expectedPreviousPublicationId: string | null;
}

function requireActivationInput(value: unknown): ActivationInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'displayName',
      'minecraftVersion',
      'packVersion',
      'publicationId',
      'previewAssetSetId',
      'isDefault',
      'expectedPreviousPublicationId',
    ]) ||
    !boundedText(value.displayName, 120) ||
    !boundedText(value.minecraftVersion, 40) ||
    !boundedText(value.packVersion, 80) ||
    typeof value.publicationId !== 'string' ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(value.publicationId) ||
    typeof value.previewAssetSetId !== 'string' ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(value.previewAssetSetId) ||
    typeof value.isDefault !== 'boolean' ||
    (value.expectedPreviousPublicationId !== null &&
      (typeof value.expectedPreviousPublicationId !== 'string' ||
        !CORE_DATASET_PUBLICATION_ID_PATTERN.test(value.expectedPreviousPublicationId)))
  ) {
    throw new Error('Activation body does not satisfy the exact dataset descriptor contract.');
  }
  return value as unknown as ActivationInput;
}

export type VerifyPublicationPair = (
  publicationId: string,
  previewAssetSetId: string,
) => Promise<CommittedDatasetIdentity>;

export async function handleDatasetChannelActivation(
  request: Request,
  runtime: DatasetRuntime,
  url: URL,
  verifyPair: VerifyPublicationPair,
): Promise<Response> {
  const route = DATASET_CHANNEL_ACTIVATION_ROUTE.exec(url.pathname);
  if (!route) return noStoreJson({error: 'Unknown dataset channel operation.'}, 404);
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const authorizationFailure = await authorizeDatasetAdmin(
    request,
    runtime.DATASET_ADMIN_ENABLED,
    runtime.CORE_DATASET_UPLOAD_TOKEN,
  );
  if (authorizationFailure) return authorizationFailure;
  const slug = route[1];
  if (slug.length > 80) return noStoreJson({error: 'Dataset slug is too long.'}, 400);
  if (url.search) {
    console.warn('A dataset channel activation with query parameters was refused.', {slug});
    return noStoreJson({error: 'Activation does not accept query parameters.'}, 400);
  }
  const contentLength = request.headers.get('content-length');
  if (!contentLength || !/^[1-9]\d*$/.test(contentLength) || Number(contentLength) > 4096) {
    return noStoreJson({error: 'Activation requires a bounded JSON body.'}, 400);
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return noStoreJson({error: 'Activation requires Content-Type application/json.'}, 415);
  }

  let input: ActivationInput;
  try {
    input = requireActivationInput(await request.json());
  } catch (error) {
    console.warn('A dataset channel activation body failed validation.', {slug, error});
    return noStoreJson({error: 'Activation body is invalid.'}, 400);
  }
  const db = runtime.DB;
  if (!db) {
    console.error('Dataset activation cannot proceed because the DB binding is unavailable.', {slug});
    return noStoreJson({error: 'Dataset registry storage is unavailable.'}, 503);
  }

  try {
    await ensureDatasetSchema(db);
    const committed = await db
      .prepare('SELECT publication_id FROM dataset_publications WHERE publication_id = ?')
      .bind(input.publicationId)
      .first<{publication_id: string}>();
    if (!committed) {
      console.warn('Dataset activation targeted a core publication absent from D1.', {
        slug,
        publicationId: input.publicationId,
      });
      return noStoreJson({error: 'Core dataset publication is not committed.'}, 409);
    }
    const immutableIdentity = await verifyPair(input.publicationId, input.previewAssetSetId);
    requireExactGtnhActivationBinding(slug, input, immutableIdentity);

    const now = Date.now();
    const statements = [];
    if (input.isDefault) {
      const expectationGuard = input.expectedPreviousPublicationId === null
        ? 'NOT EXISTS (SELECT 1 FROM dataset_channels target WHERE target.slug = ?)'
        : `EXISTS (
             SELECT 1 FROM dataset_channels target
             WHERE target.slug = ? AND target.publication_id = ?
           )`;
      statements.push(
        db
          .prepare(
            `UPDATE dataset_channels
             SET is_default = 0
             WHERE is_default = 1 AND slug <> ? AND ${expectationGuard}`,
          )
          .bind(
            slug,
            slug,
            ...(input.expectedPreviousPublicationId === null
              ? []
              : [input.expectedPreviousPublicationId]),
          ),
      );
    }
    if (input.expectedPreviousPublicationId === null) {
      statements.push(
        db
          .prepare(
            `INSERT INTO dataset_channels
               (slug, display_name, minecraft_version, pack_version, publication_id,
                preview_asset_set_id, is_default, revision, activated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?
             WHERE NOT EXISTS (SELECT 1 FROM dataset_channels target WHERE target.slug = ?)
               AND (
                 ? = 1 OR EXISTS (
                   SELECT 1 FROM dataset_channels existing_default
                   WHERE existing_default.is_default = 1 AND existing_default.slug <> ?
                 )
               )`,
          )
          .bind(
            slug,
            input.displayName,
            input.minecraftVersion,
            input.packVersion,
            input.publicationId,
            input.previewAssetSetId,
            input.isDefault ? 1 : 0,
            now,
            slug,
            input.isDefault ? 1 : 0,
            slug,
          ),
      );
    } else {
      statements.push(
        db
          .prepare(
            `UPDATE dataset_channels
             SET display_name = ?, minecraft_version = ?, pack_version = ?,
                 publication_id = ?, preview_asset_set_id = ?, is_default = ?,
                 revision = revision + 1, activated_at = ?
             WHERE slug = ? AND publication_id = ?
               AND (
                 ? = 1 OR EXISTS (
                   SELECT 1 FROM dataset_channels existing_default
                   WHERE existing_default.is_default = 1 AND existing_default.slug <> ?
                 )
               )`,
          )
          .bind(
            input.displayName,
            input.minecraftVersion,
            input.packVersion,
            input.publicationId,
            input.previewAssetSetId,
            input.isDefault ? 1 : 0,
            now,
            slug,
            input.expectedPreviousPublicationId,
            input.isDefault ? 1 : 0,
            slug,
          ),
      );
    }
    const results = await db.batch(statements);
    if (results.some(result => !result.success)) {
      throw new Error('D1 reported an unsuccessful atomic channel activation statement.');
    }
    const mutation = results.at(-1);
    if (mutation?.meta?.changes !== 1) {
      console.warn('Dataset channel activation refused a stale expected previous state.', {
        slug,
        expectedPreviousPublicationId: input.expectedPreviousPublicationId,
        changes: mutation?.meta?.changes,
      });
      return noStoreJson(
        {error: 'Dataset channel state changed or the requested default invariant is invalid; refresh before retrying.'},
        409,
      );
    }
    const {expectedPreviousPublicationId: _expectedPreviousPublicationId, ...descriptorInput} = input;
    const descriptor: DatasetDescriptor = {slug, ...descriptorInput};
    await invalidateCatalogCache(request, 'channel activation');
    return noStoreJson({dataset: descriptor}, 200);
  } catch (error) {
    console.error('Dataset channel activation failed closed.', {
      slug,
      publicationId: input.publicationId,
      previewAssetSetId: input.previewAssetSetId,
      error,
    });
    return noStoreJson({error: 'Dataset channel activation failed verification.'}, 409);
  }
}

interface DatasetChannelIdentityRow {
  slug: string;
  publication_id: string;
  preview_asset_set_id: string;
  is_default: number;
}

/**
 * Removes only a non-default mutable channel pointer when its exact core/preview identity pair
 * still matches. Immutable R2 publications and preview sets remain untouched so an operator can
 * reactivate the same content-addressed pair later.
 */
export async function handleDatasetChannelDeletion(
  request: Request,
  runtime: DatasetRuntime,
  url: URL,
): Promise<Response> {
  const route = DATASET_CHANNEL_DELETION_ROUTE.exec(url.pathname);
  if (!route) return noStoreJson({error: 'Unknown dataset channel operation.'}, 404);
  if (request.method !== 'DELETE') return methodNotAllowed('DELETE');
  const authorizationFailure = await authorizeDatasetAdmin(
    request,
    runtime.DATASET_ADMIN_ENABLED,
    runtime.CORE_DATASET_UPLOAD_TOKEN,
  );
  if (authorizationFailure) return authorizationFailure;

  const slug = route[1];
  if (slug.length > 80) return noStoreJson({error: 'Dataset slug is too long.'}, 400);
  if (url.search) {
    console.warn('A dataset channel deletion with query parameters was refused.', {slug});
    return noStoreJson({error: 'Channel deletion does not accept query parameters.'}, 400);
  }
  if (
    request.headers.get('content-length') !== '0' ||
    request.headers.has('transfer-encoding')
  ) {
    console.warn('A dataset channel deletion with invalid body framing was refused.', {slug});
    return noStoreJson({error: 'Channel deletion requires an explicit empty body.'}, 400);
  }
  if (request.body !== null) {
    try {
      if ((await request.arrayBuffer()).byteLength !== 0) {
        console.warn('A dataset channel deletion with a non-empty body was refused.', {slug});
        return noStoreJson({error: 'Channel deletion does not accept a body.'}, 400);
      }
    } catch (error) {
      console.warn('A dataset channel deletion body could not be verified as empty.', {slug, error});
      return noStoreJson({error: 'Channel deletion body is invalid.'}, 400);
    }
  }
  const expectedPublicationId = request.headers.get(EXPECTED_PUBLICATION_HEADER);
  const expectedPreviewAssetSetId = request.headers.get(EXPECTED_PREVIEW_HEADER);
  if (
    !expectedPublicationId ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(expectedPublicationId) ||
    !expectedPreviewAssetSetId ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(expectedPreviewAssetSetId)
  ) {
    console.warn('A dataset channel deletion without an exact expected identity pair was refused.', {
      slug,
    });
    return noStoreJson(
      {error: 'Channel deletion requires canonical expected publication and preview identities.'},
      400,
    );
  }

  const db = runtime.DB;
  if (!db) {
    console.error('Dataset channel deletion cannot proceed because the DB binding is unavailable.', {
      slug,
    });
    return noStoreJson({error: 'Dataset registry storage is unavailable.'}, 503);
  }

  try {
    await ensureDatasetSchema(db);
    const channel = await db
      .prepare(
        `SELECT slug, publication_id, preview_asset_set_id, is_default
         FROM dataset_channels WHERE slug = ?`,
      )
      .bind(slug)
      .first<DatasetChannelIdentityRow>();
    if (!channel) return noStoreJson({error: 'Dataset channel was not found.'}, 404);
    if (channel.is_default !== 0 && channel.is_default !== 1) {
      throw new Error('D1 returned an invalid dataset channel default flag.');
    }
    if (channel.is_default === 1) {
      console.warn('Deletion of the default dataset channel was refused.', {slug});
      return noStoreJson(
        {error: 'The default dataset channel must be replaced before it can be deleted.'},
        409,
      );
    }
    if (
      channel.publication_id !== expectedPublicationId ||
      channel.preview_asset_set_id !== expectedPreviewAssetSetId
    ) {
      console.warn('Dataset channel deletion refused a stale expected identity pair.', {
        slug,
        expectedPublicationId,
        expectedPreviewAssetSetId,
        observedPublicationId: channel.publication_id,
        observedPreviewAssetSetId: channel.preview_asset_set_id,
      });
      return noStoreJson(
        {error: 'Dataset channel identity changed; refresh the catalog before retrying.'},
        409,
      );
    }
    const result = await db
      .prepare(
        `DELETE FROM dataset_channels
         WHERE slug = ? AND is_default = 0
           AND publication_id = ? AND preview_asset_set_id = ?`,
      )
      .bind(slug, expectedPublicationId, expectedPreviewAssetSetId)
      .run();
    if (!result.success || result.meta?.changes !== 1) {
      console.warn('Dataset channel deletion lost a concurrent state race and changed nothing.', {
        slug,
        changes: result.meta?.changes,
      });
      return noStoreJson({error: 'Dataset channel changed during deletion; retry explicitly.'}, 409);
    }
    console.info('Dataset channel deactivated.', {
      slug,
      publicationId: expectedPublicationId,
      previewAssetSetId: expectedPreviewAssetSetId,
    });
    await invalidateCatalogCache(request, 'channel deletion');
    return noStoreJson(
      {
        deleted: {
          slug,
          publicationId: expectedPublicationId,
          previewAssetSetId: expectedPreviewAssetSetId,
        },
      },
      200,
    );
  } catch (error) {
    console.error('Dataset channel deletion failed closed.', {slug, error});
    return noStoreJson({error: 'Dataset channel deletion failed.'}, 500);
  }
}

export async function registerCommittedCorePublication(
  db: D1Database,
  record: {
    publicationId: string;
    manifestSha256: string;
    objectCount: number;
    storedBytes: number;
  },
): Promise<void> {
  await ensureDatasetSchema(db);
  const existing = await db
    .prepare(
      `SELECT publication_id, manifest_sha256, object_count, stored_bytes
       FROM dataset_publications WHERE publication_id = ?`,
    )
    .bind(record.publicationId)
    .first<{
      publication_id: string;
      manifest_sha256: string;
      object_count: number;
      stored_bytes: number;
    }>();
  if (existing) {
    if (
      existing.manifest_sha256 !== record.manifestSha256 ||
      existing.object_count !== record.objectCount ||
      existing.stored_bytes !== record.storedBytes
    ) {
      throw new Error('D1 contains conflicting immutable metadata for this publication ID.');
    }
    return;
  }
  const result = await db
    .prepare(
      `INSERT INTO dataset_publications
         (publication_id, manifest_sha256, object_count, stored_bytes, committed_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      record.publicationId,
      record.manifestSha256,
      record.objectCount,
      record.storedBytes,
      Date.now(),
    )
    .run();
  if (!result.success) throw new Error('D1 rejected the committed core publication record.');
}
