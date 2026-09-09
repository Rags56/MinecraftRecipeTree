import {CORE_DATASET_PUBLICATION_ID_PATTERN} from './coreDatasetContract.ts';
import {DATASET_SLUG_PATTERN, ensureDatasetSchema} from './datasetRegistry.ts';
import {
  type D1Database,
  type DatasetRuntime,
  methodNotAllowed,
  noStoreJson,
  sha256Hex,
} from './datasetRuntime.ts';
import {AUTH_ROUTE_PREFIX, currentUser, ensureUserAccountSchema} from './userAccounts.ts';
import {betaCatalogIncludesPublication} from './betaDataProxy.ts';

export const RECIPE_FAVORITES_ROUTE = '/api/recipe-favorites';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_CLAIM_BODY_BYTES = 96 * 1024;
const MAX_CLAIM_FAVORITES = 100;
// Free-tier D1 Workers allow 50 queries per invocation. Leave room for account,
// pack, and schema checks around the exact-reference delete batch.
const MAX_CLEANUP_FAVORITES = 25;
const MAX_ITEM_KEY_LENGTH = 512;
const MAX_CLIENT_ID_LENGTH = 128;
const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_GROUPED_FAVORITES = 50_000;
const LEADERBOARD_LIMIT = 100;
const UNSAFE_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

const legacySchemaStatements = [
  `CREATE TABLE IF NOT EXISTS recipe_favorites (
    pack_slug TEXT NOT NULL,
    publication_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    client_hash TEXT NOT NULL,
    recipe_category INTEGER NOT NULL,
    recipe_index INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS recipe_favorites_user_item_idx
   ON recipe_favorites (pack_slug, publication_id, item_key, client_hash)`,
  `CREATE INDEX IF NOT EXISTS recipe_favorites_ranking_idx
   ON recipe_favorites (pack_slug, publication_id, item_key, recipe_category, recipe_index)`,
  `CREATE INDEX IF NOT EXISTS recipe_favorites_client_hash_idx
   ON recipe_favorites (client_hash)`,
] as const;

const initializedDatabases = new WeakMap<object, Promise<void>>();

export function ensureRecipeFavoritesSchema(db: D1Database): Promise<void> {
  const cached = initializedDatabases.get(db as object);
  if (cached) return cached;
  const operation = Promise.all([
    ensureDatasetSchema(db),
    ensureUserAccountSchema(db),
    db.batch(legacySchemaStatements.map(statement => db.prepare(statement))).then(results => {
      if (results.some(result => !result.success)) {
        throw new Error('D1 reported an unsuccessful legacy recipe-favorites schema statement.');
      }
    }),
  ])
    .then(() => undefined)
    .catch(error => {
      initializedDatabases.delete(db as object);
      console.error('Recipe-favorites schema initialization failed.', error);
      throw error;
    });
  initializedDatabases.set(db as object, operation);
  return operation;
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
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !UNSAFE_TEXT_PATTERN.test(value)
  );
}

function recipeRef(value: unknown): [number, number] | null | undefined {
  if (value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(part => Number.isSafeInteger(part) && part >= 0)
  ) {
    return undefined;
  }
  return [value[0] as number, value[1] as number];
}

function requestOriginAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

async function parseJsonBody(
  request: Request,
  maximumBytes = MAX_BODY_BYTES,
): Promise<unknown | Response> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximumBytes)) {
    return noStoreJson({error: 'Favorite update is too large.'}, 413);
  }
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBytes) {
      return noStoreJson({error: 'Favorite update is too large.'}, 413);
    }
    return JSON.parse(body) as unknown;
  } catch {
    return noStoreJson({error: 'Favorite update must be valid JSON.'}, 400);
  }
}

async function requireCurrentPack(
  runtime: DatasetRuntime,
  db: D1Database,
  packSlug: string,
  publicationId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT slug FROM dataset_channels
       WHERE slug = ? AND publication_id = ?
       LIMIT 1`,
    )
    .bind(packSlug, publicationId)
    .first<{slug: string}>();
  if (row?.slug === packSlug) return true;
  return (await betaCatalogIncludesPublication(runtime, packSlug, publicationId)) === true;
}

function packIdentity(url: URL): {packSlug: string; publicationId: string} | null {
  const packSlug = url.searchParams.get('packSlug');
  const publicationId = url.searchParams.get('publicationId');
  if (
    !packSlug ||
    !DATASET_SLUG_PATTERN.test(packSlug) ||
    packSlug.length > 80 ||
    !publicationId ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(publicationId) ||
    [...url.searchParams.keys()].some(key => key !== 'packSlug' && key !== 'publicationId') ||
    url.searchParams.getAll('packSlug').length !== 1 ||
    url.searchParams.getAll('publicationId').length !== 1
  ) {
    return null;
  }
  return {packSlug, publicationId};
}

interface FavoriteRow {
  item_key: string;
  recipe_category: number;
  recipe_index: number;
  favorite_count: number;
}

interface PersonalFavoriteRow {
  item_key: string;
  recipe_category: number;
  recipe_index: number;
  updated_at: number;
}

interface LeaderboardRow {
  identity_type: 'account' | 'anonymous';
  identity_key: string;
  display_name: string;
  avatar_key: string | null;
  favorite_count: number;
}

async function requestingAnonymousClientHash(request: Request): Promise<string | null> {
  const clientId = request.headers.get('X-MRT-Favorite-Client');
  if (!clientId) return null;
  if (
    !boundedText(clientId, MAX_CLIENT_ID_LENGTH) ||
    !/^[a-f0-9-]{32,128}$/iu.test(clientId)
  ) {
    console.warn('A favorite leaderboard request supplied an invalid browser identifier.');
    return null;
  }
  return sha256Hex(new TextEncoder().encode(clientId));
}

function validFavoriteIdentity(row: {
  item_key: string;
  recipe_category: number;
  recipe_index: number;
}): boolean {
  return (
    boundedText(row.item_key, MAX_ITEM_KEY_LENGTH) &&
    Number.isSafeInteger(row.recipe_category) &&
    row.recipe_category >= 0 &&
    Number.isSafeInteger(row.recipe_index) &&
    row.recipe_index >= 0
  );
}

function validFavoriteRow(row: FavoriteRow): boolean {
  return (
    validFavoriteIdentity(row) &&
    Number.isSafeInteger(row.favorite_count) &&
    row.favorite_count >= 1
  );
}

async function validateRequestedPack(runtime: DatasetRuntime, db: D1Database, url: URL) {
  const identity = packIdentity(url);
  if (!identity) return {response: noStoreJson({error: 'A current saved pack is required.'}, 400)};
  if (!(await requireCurrentPack(runtime, db, identity.packSlug, identity.publicationId))) {
    return {response: noStoreJson({error: 'That saved pack version is not available.'}, 404)};
  }
  return identity;
}

async function getCommunityFavorites(
  runtime: DatasetRuntime,
  db: D1Database,
  url: URL,
): Promise<Response> {
  const pack = await validateRequestedPack(runtime, db, url);
  if ('response' in pack) return pack.response;
  const result = await db
    .prepare(
      `SELECT item_key, recipe_category, recipe_index, COUNT(*) AS favorite_count
       FROM (
         SELECT item_key, recipe_category, recipe_index
         FROM account_recipe_favorites
         WHERE pack_slug = ? AND publication_id = ?

         UNION ALL

         SELECT item_key, recipe_category, recipe_index
         FROM recipe_favorites
         WHERE pack_slug = ? AND publication_id = ?
       ) AS community_favorites
       GROUP BY item_key, recipe_category, recipe_index
       ORDER BY item_key ASC, favorite_count DESC, recipe_category ASC, recipe_index ASC
       LIMIT ?`,
    )
    .bind(
      pack.packSlug,
      pack.publicationId,
      pack.packSlug,
      pack.publicationId,
      MAX_GROUPED_FAVORITES,
    )
    .all<FavoriteRow>();
  if (!result.success) throw new Error('D1 reported an unsuccessful community-favorites query.');

  const favorites: Array<{itemKey: string; recipeRef: [number, number]; count: number}> = [];
  const selectedItems = new Set<string>();
  for (const row of result.results ?? []) {
    if (!validFavoriteRow(row)) {
      throw new Error('Community recipe-favorites storage contains invalid aggregate data.');
    }
    if (selectedItems.has(row.item_key)) continue;
    selectedItems.add(row.item_key);
    favorites.push({
      itemKey: row.item_key,
      recipeRef: [row.recipe_category, row.recipe_index],
      count: row.favorite_count,
    });
  }
  return noStoreJson({favorites});
}

async function getLeaderboard(
  request: Request,
  runtime: DatasetRuntime,
  db: D1Database,
  url: URL,
): Promise<Response> {
  const pack = await validateRequestedPack(runtime, db, url);
  if ('response' in pack) return pack.response;
  const [user, anonymousClientHash] = await Promise.all([
    currentUser(request, runtime),
    requestingAnonymousClientHash(request),
  ]);
  const result = await db
    .prepare(
      `WITH favorite_users AS (
         SELECT 'account' AS identity_type,
                account_recipe_favorites.user_id AS identity_key,
                users.display_name AS display_name,
                users.avatar_key AS avatar_key,
                COUNT(*) AS favorite_count
         FROM account_recipe_favorites
         INNER JOIN users ON users.id = account_recipe_favorites.user_id
         WHERE account_recipe_favorites.pack_slug = ?
           AND account_recipe_favorites.publication_id = ?
         GROUP BY account_recipe_favorites.user_id, users.display_name, users.avatar_key

         UNION ALL

         SELECT 'anonymous' AS identity_type,
                recipe_favorites.client_hash AS identity_key,
                'Unknown user' AS display_name,
                NULL AS avatar_key,
                COUNT(*) AS favorite_count
         FROM recipe_favorites
         WHERE recipe_favorites.pack_slug = ?
           AND recipe_favorites.publication_id = ?
         GROUP BY recipe_favorites.client_hash
       )
       SELECT identity_type, identity_key, display_name, avatar_key, favorite_count
       FROM favorite_users
       ORDER BY favorite_count DESC,
                display_name COLLATE NOCASE ASC,
                identity_key ASC
       LIMIT ?`,
    )
    .bind(
      pack.packSlug,
      pack.publicationId,
      pack.packSlug,
      pack.publicationId,
      LEADERBOARD_LIMIT,
    )
    .all<LeaderboardRow>();
  if (!result.success) throw new Error('D1 reported an unsuccessful favorite-leaderboard query.');
  const entries = (result.results ?? []).map(row => {
    if (
      !boundedText(row.display_name, MAX_DISPLAY_NAME_LENGTH) ||
      (row.identity_type !== 'account' && row.identity_type !== 'anonymous') ||
      !boundedText(row.identity_key, MAX_CLIENT_ID_LENGTH) ||
      (row.avatar_key !== null && !/^[a-f0-9]{64}$/u.test(row.avatar_key)) ||
      !Number.isSafeInteger(row.favorite_count) ||
      row.favorite_count < 1
    ) {
      throw new Error('Favorite leaderboard storage contains invalid aggregate data.');
    }
    return {
      displayName: row.display_name,
      count: row.favorite_count,
      isAnonymous: row.identity_type === 'anonymous',
      avatarUrl: row.avatar_key ? `${AUTH_ROUTE_PREFIX}avatar/${row.avatar_key}` : null,
      isCurrent:
        (row.identity_type === 'account' && row.identity_key === user?.id) ||
        (row.identity_type === 'anonymous' && row.identity_key === anonymousClientHash),
    };
  });
  return noStoreJson({entries});
}

async function getPersonalFavorites(
  request: Request,
  runtime: DatasetRuntime,
  db: D1Database,
  url: URL,
): Promise<Response> {
  const user = await currentUser(request, runtime);
  if (!user) return noStoreJson({error: 'Sign in to sync favorites.'}, 401);
  const pack = await validateRequestedPack(runtime, db, url);
  if ('response' in pack) return pack.response;
  const result = await db
    .prepare(
      `SELECT item_key, recipe_category, recipe_index, updated_at
       FROM account_recipe_favorites
       WHERE user_id = ? AND pack_slug = ? AND publication_id = ?
       ORDER BY item_key ASC
       LIMIT ?`,
    )
    .bind(user.id, pack.packSlug, pack.publicationId, MAX_GROUPED_FAVORITES)
    .all<PersonalFavoriteRow>();
  if (!result.success) throw new Error('D1 reported an unsuccessful personal-favorites query.');
  const favorites = (result.results ?? []).map(row => {
    if (!validFavoriteIdentity(row) || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) {
      throw new Error('Personal recipe-favorites storage contains invalid data.');
    }
    return {
      itemKey: row.item_key,
      recipeRef: [row.recipe_category, row.recipe_index] as [number, number],
      updatedAt: row.updated_at,
    };
  });
  return noStoreJson({favorites});
}

async function updateFavorite(
  request: Request,
  runtime: DatasetRuntime,
  db: D1Database,
  url: URL,
): Promise<Response> {
  if (!requestOriginAllowed(request, url)) {
    console.warn('A cross-origin recipe-favorite write was refused.', {
      origin: request.headers.get('origin'),
    });
    return noStoreJson({error: 'Cross-origin favorite updates are not allowed.'}, 403);
  }
  const parsed = await parseJsonBody(request);
  if (parsed instanceof Response) return parsed;
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ['packSlug', 'publicationId', 'clientId', 'itemKey', 'recipeRef'])
  ) {
    return noStoreJson({error: 'Favorite update has an invalid shape.'}, 400);
  }
  const ref = recipeRef(parsed.recipeRef);
  if (
    !boundedText(parsed.packSlug, 80) ||
    !DATASET_SLUG_PATTERN.test(parsed.packSlug) ||
    typeof parsed.publicationId !== 'string' ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(parsed.publicationId) ||
    !boundedText(parsed.clientId, MAX_CLIENT_ID_LENGTH) ||
    !/^[a-f0-9-]{32,128}$/iu.test(parsed.clientId) ||
    !boundedText(parsed.itemKey, MAX_ITEM_KEY_LENGTH) ||
    ref === undefined
  ) {
    return noStoreJson({error: 'Favorite update contains invalid values.'}, 400);
  }
  if (!(await requireCurrentPack(runtime, db, parsed.packSlug, parsed.publicationId))) {
    return noStoreJson({error: 'That saved pack version is not available.'}, 404);
  }

  const user = await currentUser(request, runtime);
  if (!user && request.headers.has('authorization')) {
    return noStoreJson({error: 'Your account session is invalid or expired.'}, 401);
  }
  const now = Date.now();
  if (user) {
    const result = ref === null
      ? await db
          .prepare(
            `DELETE FROM account_recipe_favorites
             WHERE user_id = ? AND pack_slug = ? AND publication_id = ? AND item_key = ?`,
          )
          .bind(user.id, parsed.packSlug, parsed.publicationId, parsed.itemKey)
          .run()
      : await db
          .prepare(
            `INSERT INTO account_recipe_favorites
               (user_id, pack_slug, publication_id, item_key,
                recipe_category, recipe_index, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, pack_slug, publication_id, item_key)
             DO UPDATE SET recipe_category = excluded.recipe_category,
                           recipe_index = excluded.recipe_index,
                           updated_at = excluded.updated_at`,
          )
          .bind(
            user.id,
            parsed.packSlug,
            parsed.publicationId,
            parsed.itemKey,
            ref[0],
            ref[1],
            now,
          )
          .run();
    if (!result.success) throw new Error('D1 reported an unsuccessful account favorite update.');
    return noStoreJson({saved: ref !== null, synced: true});
  }

  const clientHash = await sha256Hex(new TextEncoder().encode(parsed.clientId));
  const result = ref === null
    ? await db
        .prepare(
          `DELETE FROM recipe_favorites
           WHERE pack_slug = ? AND publication_id = ? AND item_key = ? AND client_hash = ?`,
        )
        .bind(parsed.packSlug, parsed.publicationId, parsed.itemKey, clientHash)
        .run()
    : await db
        .prepare(
          `INSERT INTO recipe_favorites
             (pack_slug, publication_id, item_key, client_hash,
              recipe_category, recipe_index, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (pack_slug, publication_id, item_key, client_hash)
           DO UPDATE SET recipe_category = excluded.recipe_category,
                         recipe_index = excluded.recipe_index,
                         updated_at = excluded.updated_at`,
        )
        .bind(
          parsed.packSlug,
          parsed.publicationId,
          parsed.itemKey,
          clientHash,
          ref[0],
          ref[1],
          now,
        )
        .run();
  if (!result.success) throw new Error('D1 reported an unsuccessful anonymous favorite update.');
  return noStoreJson({saved: ref !== null, synced: false});
}

async function claimAnonymousFavorites(
  request: Request,
  runtime: DatasetRuntime,
  db: D1Database,
  url: URL,
): Promise<Response> {
  if (!requestOriginAllowed(request, url)) {
    console.warn('A cross-origin favorite claim was refused.', {origin: request.headers.get('origin')});
    return noStoreJson({error: 'Cross-origin favorite updates are not allowed.'}, 403);
  }
  const user = await currentUser(request, runtime);
  if (!user) return noStoreJson({error: 'Sign in to sync favorites.'}, 401);
  const parsed = await parseJsonBody(request, MAX_CLAIM_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ['clientId', 'favorites', 'packSlug', 'publicationId']) ||
    !boundedText(parsed.clientId, MAX_CLIENT_ID_LENGTH) ||
    !/^[a-f0-9-]{32,128}$/iu.test(parsed.clientId) ||
    !boundedText(parsed.packSlug, 80) ||
    !DATASET_SLUG_PATTERN.test(parsed.packSlug) ||
    typeof parsed.publicationId !== 'string' ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(parsed.publicationId) ||
    !Array.isArray(parsed.favorites) ||
    parsed.favorites.length > MAX_CLAIM_FAVORITES
  ) {
    return noStoreJson({error: 'Favorite claim contains invalid values.'}, 400);
  }
  const favorites: Array<{itemKey: string; recipeRef: [number, number]}> = [];
  for (const [index, value] of parsed.favorites.entries()) {
    if (!isRecord(value) || !hasExactKeys(value, ['itemKey', 'recipeRef'])) {
      console.warn('A browser favorite claim had an invalid entry shape.', {index});
      return noStoreJson({error: 'Favorite claim contains invalid values.'}, 400);
    }
    const ref = recipeRef(value.recipeRef);
    if (!boundedText(value.itemKey, MAX_ITEM_KEY_LENGTH) || !ref) {
      console.warn('A browser favorite claim had invalid entry values.', {index});
      return noStoreJson({error: 'Favorite claim contains invalid values.'}, 400);
    }
    favorites.push({itemKey: value.itemKey, recipeRef: ref});
  }
  if (!(await requireCurrentPack(runtime, db, parsed.packSlug, parsed.publicationId))) {
    return noStoreJson({error: 'That saved pack version is not available.'}, 404);
  }
  const clientHash = await sha256Hex(new TextEncoder().encode(parsed.clientId));
  const now = Date.now();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO account_recipe_favorites
           (user_id, pack_slug, publication_id, item_key,
            recipe_category, recipe_index, updated_at)
         SELECT ?, pack_slug, publication_id, item_key,
                recipe_category, recipe_index, updated_at
         FROM recipe_favorites
         WHERE client_hash = ?
         ON CONFLICT (user_id, pack_slug, publication_id, item_key)
         DO UPDATE SET recipe_category = excluded.recipe_category,
                       recipe_index = excluded.recipe_index,
                       updated_at = excluded.updated_at
         WHERE excluded.updated_at > account_recipe_favorites.updated_at`,
      )
      .bind(user.id, clientHash),
    db.prepare('DELETE FROM recipe_favorites WHERE client_hash = ?').bind(clientHash),
    ...favorites.map(favorite =>
      db
        .prepare(
          `INSERT INTO account_recipe_favorites
             (user_id, pack_slug, publication_id, item_key,
              recipe_category, recipe_index, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, pack_slug, publication_id, item_key)
           DO UPDATE SET recipe_category = excluded.recipe_category,
                         recipe_index = excluded.recipe_index,
                         updated_at = excluded.updated_at`,
        )
        .bind(
          user.id,
          parsed.packSlug,
          parsed.publicationId,
          favorite.itemKey,
          favorite.recipeRef[0],
          favorite.recipeRef[1],
          now,
        ),
    ),
  ]);
  if (results.some(result => !result.success)) {
    throw new Error('D1 reported an unsuccessful anonymous favorite claim.');
  }
  return noStoreJson({
    claimed: results[0]?.meta?.changes ?? 0,
    imported: favorites.length,
  });
}

async function cleanupPersonalFavorites(
  request: Request,
  runtime: DatasetRuntime,
  db: D1Database,
  url: URL,
): Promise<Response> {
  if (!requestOriginAllowed(request, url)) {
    console.warn('A cross-origin favorite cleanup was refused.', {
      origin: request.headers.get('origin'),
    });
    return noStoreJson({error: 'Cross-origin favorite updates are not allowed.'}, 403);
  }
  const user = await currentUser(request, runtime);
  if (!user) return noStoreJson({error: 'Sign in to sync favorites.'}, 401);
  const parsed = await parseJsonBody(request, MAX_CLAIM_BODY_BYTES);
  if (
    parsed instanceof Response ||
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ['favorites', 'packSlug', 'publicationId']) ||
    !boundedText(parsed.packSlug, 80) ||
    !DATASET_SLUG_PATTERN.test(parsed.packSlug) ||
    typeof parsed.publicationId !== 'string' ||
    !CORE_DATASET_PUBLICATION_ID_PATTERN.test(parsed.publicationId) ||
    !Array.isArray(parsed.favorites) ||
    parsed.favorites.length < 1 ||
    parsed.favorites.length > MAX_CLEANUP_FAVORITES
  ) {
    return parsed instanceof Response
      ? parsed
      : noStoreJson({error: 'Favorite cleanup contains invalid values.'}, 400);
  }
  const favorites: Array<{itemKey: string; recipeRef: [number, number]}> = [];
  const seen = new Set<string>();
  for (const [index, value] of parsed.favorites.entries()) {
    if (!isRecord(value) || !hasExactKeys(value, ['itemKey', 'recipeRef'])) {
      console.warn('A favorite cleanup had an invalid entry shape.', {index});
      return noStoreJson({error: 'Favorite cleanup contains invalid values.'}, 400);
    }
    const ref = recipeRef(value.recipeRef);
    const identity = `${String(value.itemKey)}\u0000${ref?.join(':') ?? ''}`;
    if (!boundedText(value.itemKey, MAX_ITEM_KEY_LENGTH) || !ref || seen.has(identity)) {
      console.warn('A favorite cleanup had invalid or duplicate entry values.', {index});
      return noStoreJson({error: 'Favorite cleanup contains invalid values.'}, 400);
    }
    seen.add(identity);
    favorites.push({itemKey: value.itemKey, recipeRef: ref});
  }
  if (!(await requireCurrentPack(runtime, db, parsed.packSlug, parsed.publicationId))) {
    return noStoreJson({error: 'That saved pack version is not available.'}, 404);
  }
  const results = await db.batch(favorites.map(favorite =>
    db
      .prepare(
        `DELETE FROM account_recipe_favorites
         WHERE user_id = ? AND pack_slug = ? AND publication_id = ?
           AND item_key = ? AND recipe_category = ? AND recipe_index = ?`,
      )
      .bind(
        user.id,
        parsed.packSlug,
        parsed.publicationId,
        favorite.itemKey,
        favorite.recipeRef[0],
        favorite.recipeRef[1],
      ),
  ));
  if (results.some(result => !result.success)) {
    throw new Error('D1 reported an unsuccessful personal favorite cleanup.');
  }
  const removed = results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);
  console.info('Unavailable personal recipe favorites were cleaned up.', {
    packSlug: parsed.packSlug,
    publicationId: parsed.publicationId,
    requested: favorites.length,
    removed,
  });
  return noStoreJson({removed});
}

export async function handleRecipeFavorites(
  request: Request,
  runtime: DatasetRuntime,
  url: URL,
): Promise<Response> {
  const db = runtime.DB;
  if (!db) return noStoreJson({error: 'Recipe favorites are unavailable.'}, 503);
  try {
    await ensureRecipeFavoritesSchema(db);
    if (url.pathname === RECIPE_FAVORITES_ROUTE) {
      if (request.method === 'GET') return getCommunityFavorites(runtime, db, url);
      if (request.method === 'PUT') return updateFavorite(request, runtime, db, url);
      return methodNotAllowed('GET, PUT');
    }
    if (url.pathname === `${RECIPE_FAVORITES_ROUTE}/leaderboard`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return getLeaderboard(request, runtime, db, url);
    }
    if (url.pathname === `${RECIPE_FAVORITES_ROUTE}/mine`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return getPersonalFavorites(request, runtime, db, url);
    }
    if (url.pathname === `${RECIPE_FAVORITES_ROUTE}/claim`) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      return claimAnonymousFavorites(request, runtime, db, url);
    }
    if (url.pathname === `${RECIPE_FAVORITES_ROUTE}/cleanup`) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      return cleanupPersonalFavorites(request, runtime, db, url);
    }
    return noStoreJson({error: 'Not found.'}, 404);
  } catch (error) {
    console.error('Recipe-favorites request failed.', {path: url.pathname, error});
    return noStoreJson({error: 'Recipe favorites are unavailable.'}, 503);
  }
}
