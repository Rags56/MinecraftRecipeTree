import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {
  TEST_ORIGIN as ORIGIN,
  TEST_USER_ID,
  supabaseTestAuthentication,
} from './testSupabaseAuth.mjs';

const {RECIPE_FAVORITES_ROUTE, handleRecipeFavorites} = await import('./recipeFavorites.ts');

const PACK = 'meatballcraft';
const PUBLICATION = 'a'.repeat(64);
const CLIENT_ID = '123e4567-e89b-12d3-a456-426614174000';
const CLIENT_HASH = createHash('sha256').update(CLIENT_ID).digest('hex');
const authentication = await supabaseTestAuthentication();

function database(favoriteRows = [], currentPackAvailable = true) {
  const calls = [];
  return {
    calls,
    batch(statements) {
      return Promise.resolve(statements.map(() => ({success: true})));
    },
    prepare(sql) {
      const call = {sql: sql.replace(/\s+/gu, ' ').trim(), values: []};
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return this;
        },
        async first() {
          if (call.sql.includes('FROM dataset_channels')) {
            return currentPackAvailable ? {slug: PACK} : null;
          }
          throw new Error(`Unexpected first query: ${call.sql}`);
        },
        async all() {
          if (call.sql.includes('FROM account_recipe_favorites')) {
            return {success: true, results: structuredClone(favoriteRows)};
          }
          throw new Error(`Unexpected all query: ${call.sql}`);
        },
        async run() {
          return {success: true, meta: {changes: 1}};
        },
      };
    },
  };
}

function getRequest(search = `packSlug=${PACK}&publicationId=${PUBLICATION}`, suffix = '') {
  return new Request(`${ORIGIN}${RECIPE_FAVORITES_ROUTE}${suffix}?${search}`);
}

function putRequest(recipeRef, authorization) {
  return new Request(`${ORIGIN}${RECIPE_FAVORITES_ROUTE}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(authorization ? {Authorization: authorization} : {}),
    },
    body: JSON.stringify({
      packSlug: PACK,
      publicationId: PUBLICATION,
      clientId: CLIENT_ID,
      itemKey: 'item|minecraft:iron_ingot',
      recipeRef,
    }),
  });
}

function claimRequest(favorites) {
  return new Request(`${ORIGIN}${RECIPE_FAVORITES_ROUTE}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      Authorization: authentication.authorization,
    },
    body: JSON.stringify({
      clientId: CLIENT_ID,
      packSlug: PACK,
      publicationId: PUBLICATION,
      favorites,
    }),
  });
}

function cleanupRequest(favorites, authorization = authentication.authorization) {
  return new Request(`${ORIGIN}${RECIPE_FAVORITES_ROUTE}/cleanup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      Authorization: authorization,
    },
    body: JSON.stringify({
      packSlug: PACK,
      publicationId: PUBLICATION,
      favorites,
    }),
  });
}

test.after(() => authentication.restoreFetch());

test('anonymous favorite claim and cleanup use the client hash index', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE recipe_favorites (
    pack_slug TEXT NOT NULL,
    publication_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    client_hash TEXT NOT NULL,
    recipe_category INTEGER NOT NULL,
    recipe_index INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(readFileSync(new URL('../drizzle/0010_slim_invisible_woman.sql', import.meta.url), 'utf8'));

  const claimPlan = db
    .prepare('EXPLAIN QUERY PLAN SELECT * FROM recipe_favorites WHERE client_hash = ?')
    .all('probe');
  const cleanupPlan = db
    .prepare('EXPLAIN QUERY PLAN DELETE FROM recipe_favorites WHERE client_hash = ?')
    .all('probe');

  for (const plan of [claimPlan, cleanupPlan]) {
    assert.ok(
      plan.some(row => String(row.detail).includes('USING INDEX recipe_favorites_client_hash_idx')),
      `expected client hash index in query plan: ${JSON.stringify(plan)}`,
    );
    assert.ok(
      plan.every(row => !String(row.detail).startsWith('SCAN recipe_favorites')),
      `unexpected full-table scan in query plan: ${JSON.stringify(plan)}`,
    );
  }
  db.close();
});

test('returns the highest-count recipe for each item and requires at least one favorite', async () => {
  const DB = database([
    {item_key: 'item|a', recipe_category: 2, recipe_index: 8, favorite_count: 4},
    {item_key: 'item|a', recipe_category: 3, recipe_index: 1, favorite_count: 2},
    {item_key: 'item|b', recipe_category: 1, recipe_index: 9, favorite_count: 1},
  ]);
  const response = await handleRecipeFavorites(
    getRequest(),
    {...authentication.runtime, DB},
    new URL(getRequest().url),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    favorites: [
      {itemKey: 'item|a', recipeRef: [2, 8], count: 4},
      {itemKey: 'item|b', recipeRef: [1, 9], count: 1},
    ],
  });
  const query = DB.calls.find(call => call.sql.includes('AS community_favorites'));
  assert.ok(query);
  assert.match(query.sql, /FROM account_recipe_favorites/u);
  assert.match(query.sql, /UNION ALL SELECT item_key, recipe_category, recipe_index FROM recipe_favorites/u);
  assert.deepEqual(query.values, [PACK, PUBLICATION, PACK, PUBLICATION, 50_000]);
});

test('leaderboard ranks account and unknown users and identifies the signed-out browser', async () => {
  const DB = database([
    {
      identity_type: 'account',
      identity_key: '11111111-1111-4111-8111-111111111111',
      display_name: 'Alex',
      avatar_key: 'b'.repeat(64),
      favorite_count: 7,
    },
    {
      identity_type: 'anonymous',
      identity_key: CLIENT_HASH,
      display_name: 'Unknown user',
      avatar_key: null,
      favorite_count: 5,
    },
    {
      identity_type: 'account',
      identity_key: '22222222-2222-4222-8222-222222222222',
      display_name: 'Builder Bee',
      avatar_key: null,
      favorite_count: 2,
    },
  ]);
  const request = getRequest(undefined, '/leaderboard');
  request.headers.set('X-MRT-Favorite-Client', CLIENT_ID);
  const response = await handleRecipeFavorites(
    request,
    {...authentication.runtime, DB},
    new URL(request.url),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    entries: [
      {displayName: 'Alex', count: 7, isAnonymous: false, avatarUrl: `/api/auth/avatar/${'b'.repeat(64)}`, isCurrent: false},
      {displayName: 'Unknown user', count: 5, isAnonymous: true, avatarUrl: null, isCurrent: true},
      {displayName: 'Builder Bee', count: 2, isAnonymous: false, avatarUrl: null, isCurrent: false},
    ],
  });
  const query = DB.calls.find(call => call.sql.includes('FROM account_recipe_favorites'));
  assert.ok(query);
  assert.match(query.sql, /INNER JOIN users ON users\.id = account_recipe_favorites\.user_id/u);
  assert.match(query.sql, /FROM recipe_favorites/u);
  assert.match(query.sql, /GROUP BY account_recipe_favorites\.user_id, users\.display_name, users\.avatar_key/u);
  assert.match(query.sql, /GROUP BY recipe_favorites\.client_hash/u);
  assert.match(query.sql, /ORDER BY favorite_count DESC/u);
  assert.deepEqual(query.values, [PACK, PUBLICATION, PACK, PUBLICATION, 100]);
});

test('leaderboard identifies the signed-in account without exposing its id', async () => {
  const DB = database([
    {
      identity_type: 'account',
      identity_key: TEST_USER_ID,
      display_name: 'Recipe Builder',
      avatar_key: null,
      favorite_count: 9,
    },
  ]);
  const request = getRequest(undefined, '/leaderboard');
  request.headers.set('Authorization', authentication.authorization);
  request.headers.set('X-MRT-Favorite-Client', CLIENT_ID);
  const response = await handleRecipeFavorites(
    request,
    {...authentication.runtime, DB},
    new URL(request.url),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    entries: [
      {displayName: 'Recipe Builder', count: 9, isAnonymous: false, avatarUrl: null, isCurrent: true},
    ],
  });
});

test('beta favorites accept the production-backed pack exposed by the beta catalog', async () => {
  const DB = database([], false);
  const previousFetch = globalThis.fetch;
  let catalogRequest;
  globalThis.fetch = async request => {
    catalogRequest = request;
    return Response.json({
      datasets: [{slug: PACK, publicationId: PUBLICATION}],
    });
  };
  try {
    const request = getRequest(undefined, '/leaderboard');
    const response = await handleRecipeFavorites(
      request,
      {DB, BETA_DATA_ORIGIN: 'https://production.example'},
      new URL(request.url),
    );

    assert.equal(response.status, 200);
    assert.ok(catalogRequest instanceof Request);
    assert.equal(catalogRequest.url, 'https://production.example/api/datasets');
    assert.equal(catalogRequest.headers.get('authorization'), null);
    assert.equal(catalogRequest.headers.get('cookie'), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('signed-in favorite writes use the account identity instead of the anonymous client hash', async () => {
  const DB = database();
  const request = putRequest([4, 5], authentication.authorization);
  const response = await handleRecipeFavorites(
    request,
    {...authentication.runtime, DB},
    new URL(request.url),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {saved: true, synced: true});
  const write = DB.calls.find(call => call.sql.startsWith('INSERT INTO account_recipe_favorites'));
  assert.ok(write);
  assert.deepEqual(write.values.slice(0, 4), [
    TEST_USER_ID,
    PACK,
    PUBLICATION,
    'item|minecraft:iron_ingot',
  ]);
});

test('an invalid account token is rejected instead of silently becoming an anonymous vote', async () => {
  const DB = database();
  const request = putRequest([4, 5], `Bearer ${'a'.repeat(120)}`);
  const response = await handleRecipeFavorites(
    request,
    {...authentication.runtime, DB},
    new URL(request.url),
  );

  assert.equal(response.status, 401);
  assert.equal(
    DB.calls.some(call => call.sql.startsWith('INSERT INTO recipe_favorites')),
    false,
  );
});

test('sign-in claims server votes and imports current browser-only favorites', async () => {
  const DB = database();
  const request = claimRequest([
    {itemKey: 'item|minecraft:iron_ingot', recipeRef: [4, 5]},
    {itemKey: 'item|minecraft:gold_ingot', recipeRef: [6, 7]},
  ]);
  const response = await handleRecipeFavorites(
    request,
    {...authentication.runtime, DB},
    new URL(request.url),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {claimed: 0, imported: 2});
  assert.ok(DB.calls.some(call => call.sql.startsWith('DELETE FROM recipe_favorites')));
  const imports = DB.calls.filter(call => call.sql.startsWith('INSERT INTO account_recipe_favorites'));
  assert.equal(imports.length, 3);
  assert.deepEqual(imports[1].values.slice(0, 6), [
    TEST_USER_ID,
    PACK,
    PUBLICATION,
    'item|minecraft:iron_ingot',
    4,
    5,
  ]);
});

test('signed-in users can batch-clean exact stale favorite references', async () => {
  const DB = database();
  DB.batch = statements => Promise.resolve(statements.map(() => ({
    success: true,
    meta: {changes: 1},
  })));
  const stale = [
    {itemKey: 'item|minecraft:iron_ingot', recipeRef: [4, 5]},
    {itemKey: 'item|minecraft:gold_ingot', recipeRef: [6, 7]},
  ];
  const request = cleanupRequest(stale);
  const response = await handleRecipeFavorites(
    request,
    {...authentication.runtime, DB},
    new URL(request.url),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {removed: 2});
  const deletions = DB.calls.filter(call =>
    call.sql.startsWith('DELETE FROM account_recipe_favorites') &&
    call.sql.includes('recipe_category = ?'),
  );
  assert.equal(deletions.length, 2);
  assert.deepEqual(deletions[0].values, [
    TEST_USER_ID,
    PACK,
    PUBLICATION,
    stale[0].itemKey,
    ...stale[0].recipeRef,
  ]);
});

test('favorite cleanup requires authentication and rejects duplicate rows', async () => {
  const unauthenticated = cleanupRequest([
    {itemKey: 'item|minecraft:iron_ingot', recipeRef: [4, 5]},
  ], '');
  assert.equal(
    (await handleRecipeFavorites(
      unauthenticated,
      {DB: database()},
      new URL(unauthenticated.url),
    )).status,
    401,
  );

  const favorite = {itemKey: 'item|minecraft:iron_ingot', recipeRef: [4, 5]};
  const duplicate = cleanupRequest([favorite, favorite]);
  assert.equal(
    (await handleRecipeFavorites(
      duplicate,
      {...authentication.runtime, DB: database()},
      new URL(duplicate.url),
    )).status,
    400,
  );
});

test('favorite cleanup stays below the free-tier D1 query budget', async () => {
  const tooMany = Array.from({length: 26}, (_, index) => ({
    itemKey: `item|fixture:${index}`,
    recipeRef: [index, 0],
  }));
  const request = cleanupRequest(tooMany);
  assert.equal(
    (await handleRecipeFavorites(
      request,
      {...authentication.runtime, DB: database()},
      new URL(request.url),
    )).status,
    400,
  );
});

test('stores one anonymous recipe vote per pack version and item', async () => {
  const DB = database();
  const request = putRequest([7, 12]);
  const response = await handleRecipeFavorites(request, {DB}, new URL(request.url));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {saved: true, synced: false});
  const write = DB.calls.find(call => call.sql.startsWith('INSERT INTO recipe_favorites'));
  assert.ok(write);
  assert.equal(write.values[0], PACK);
  assert.equal(write.values[1], PUBLICATION);
  assert.equal(write.values[2], 'item|minecraft:iron_ingot');
  assert.match(write.values[3], /^[a-f0-9]{64}$/u);
  assert.notEqual(write.values[3], CLIENT_ID);
  assert.deepEqual(write.values.slice(4, 6), [7, 12]);
});

test('clearing a preferred recipe removes that client vote', async () => {
  const DB = database();
  const request = putRequest(null);
  const response = await handleRecipeFavorites(request, {DB}, new URL(request.url));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {saved: false, synced: false});
  const deletion = DB.calls.find(call => call.sql.startsWith('DELETE FROM recipe_favorites'));
  assert.ok(deletion);
  assert.equal(deletion.values.length, 4);
});

test('rejects duplicate query parameters and cross-origin writes', async () => {
  const duplicate = getRequest(`packSlug=${PACK}&packSlug=${PACK}&publicationId=${PUBLICATION}`);
  assert.equal(
    (await handleRecipeFavorites(duplicate, {DB: database()}, new URL(duplicate.url))).status,
    400,
  );

  const crossOrigin = putRequest([1, 2]);
  crossOrigin.headers.set('Origin', 'https://attacker.example');
  assert.equal(
    (await handleRecipeFavorites(crossOrigin, {DB: database()}, new URL(crossOrigin.url))).status,
    403,
  );
});
