import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const sitesVitePlugin = await readFile(
  new URL('../build/sites-vite-plugin.ts', import.meta.url),
  'utf8',
);
const applicationSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const datasetCatalog = await readFile(new URL('../src/data/datasetCatalog.ts', import.meta.url), 'utf8');
const datasetCatalogContext = await readFile(
  new URL('../src/data/DatasetCatalogContext.tsx', import.meta.url),
  'utf8',
);
const environmentExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const d1Migrations = await Promise.all([
  readFile(new URL('../drizzle/0000_yummy_impossible_man.sql', import.meta.url), 'utf8'),
  readFile(new URL('../drizzle/0001_wide_the_hand.sql', import.meta.url), 'utf8'),
  readFile(new URL('../drizzle/0002_shiny_sunfire.sql', import.meta.url), 'utf8'),
  readFile(new URL('../drizzle/0003_tidy_ogun.sql', import.meta.url), 'utf8'),
  readFile(new URL('../drizzle/0004_rainy_maverick.sql', import.meta.url), 'utf8'),
  readFile(new URL('../drizzle/0005_harsh_stick.sql', import.meta.url), 'utf8'),
  readFile(new URL('../drizzle/0006_lumpy_ricochet.sql', import.meta.url), 'utf8'),
  readFile(new URL('../drizzle/0007_simple_madrox.sql', import.meta.url), 'utf8'),
]);

test('Cloudflare routes catalog, immutable datasets, and administration through the Worker', () => {
  assert.match(
    viteConfig,
    /defineConfig\(async \(\{command\}\) =>/,
    'the Vite configuration must distinguish local development from deployment builds',
  );
  assert.match(
    viteConfig,
    /const isLocalDev = command === ['"]serve['"] && !isCloudflareBeta && !isCloudflareProduction/,
    'only an explicit local development server may receive the production read origin',
  );
  assert.match(
    viteConfig,
    /:\s*isLocalDev\s*\?\s*\{vars:\s*\{BETA_DATA_ORIGIN\}\}\s*:\s*\{\}/,
    'local development should reuse the public production dataset catalog without changing deployment bindings',
  );
  assert.match(
    viteConfig,
    /MRT_DEPLOY_TARGET\s*===\s*['"]cloudflare-beta['"]/,
    'the standalone Cloudflare beta build must be selected explicitly',
  );
  assert.match(
    viteConfig,
    /name:\s*['"]minecraft-recipe-tree-beta['"][\s\S]*?vars:\s*\{[\s\S]*?BETA_DATA_ORIGIN[\s\S]*?\}/,
    'the standalone beta Worker must have an isolated name and read-only production data origin',
  );
  assert.match(
    viteConfig,
    /d1_databases:\s*isCloudflareBeta[\s\S]*?:\s*isCloudflareProduction[\s\S]*?:\s*!isCloudflareBeta\s*&&\s*hostingConfig\.d1/,
    'the standalone beta Worker must use its isolated D1 before the production and Sites bindings',
  );
  assert.match(
    viteConfig,
    /r2_buckets:\s*isCloudflareProduction[\s\S]*?:\s*!isCloudflareBeta\s*&&\s*hostingConfig\.r2/,
    'the standalone beta Worker must not inherit the Sites-managed R2 binding',
  );
  assert.match(
    viteConfig,
    /isCloudflareBeta[\s\S]*?binding:\s*['"]DB['"][\s\S]*?database_name:\s*CLOUDFLARE_BETA_DATABASE_NAME[\s\S]*?database_id:\s*CLOUDFLARE_BETA_DATABASE_ID/,
    'beta must bind its own D1 database rather than production storage',
  );
  assert.match(
    viteConfig,
    /binding:\s*['"]DB['"][\s\S]*?database_name:\s*CLOUDFLARE_PRODUCTION_DATABASE_NAME[\s\S]*?database_id:\s*CLOUDFLARE_PRODUCTION_DATABASE_ID/,
    'standalone production must bind the native production D1 database',
  );
  assert.match(
    viteConfig,
    /binding:\s*['"]PREVIEW_ASSETS['"][\s\S]*?bucket_name:\s*CLOUDFLARE_PRODUCTION_BUCKET_NAME/,
    'standalone production must bind the native production R2 bucket',
  );
  assert.match(
    viteConfig,
    /isCloudflareProduction[\s\S]*?name:\s*['"]minecraft-recipe-tree-production['"][\s\S]*?DATASET_ADMIN_ENABLED:\s*['"]true['"][\s\S]*?SUPABASE_URL/,
    'standalone production must enable token-authenticated administration and bind its account provider',
  );
  assert.match(
    viteConfig,
    /publicDir:\s*false(?:\s+as\s+const)?/,
    'production builds must not copy the retired public/exports corpus into dist',
  );
  assert.match(
    sitesVitePlugin,
    /resolve\(root, ['"]dist['"], ['"]client['"], ['"]exports['"]\)[\s\S]*?if \(await exists\(retiredStaticExportDirectory\)\)[\s\S]*?throw new Error\(['"]Static dataset exports must not be bundled/,
    'the build must fail closed if any retired static export directory reaches dist/client',
  );
  assert.match(
    sitesVitePlugin,
    /resolve\(root, ['"]public['"], ['"]pack-icons['"]\)[\s\S]*?resolve\(root, ['"]dist['"], ['"]client['"], ['"]pack-icons['"]\)[\s\S]*?metadata\.nlink !== 1[\s\S]*?MAX_PACK_ICON_BYTES[\s\S]*?copyFile/,
    'only the exact bounded pack icon set may be copied into the deployable client',
  );
  assert.match(
    sitesVitePlugin,
    /resolve\(root, ['"]public['"], ['"]fonts['"]\)[\s\S]*?THEME_FONT_FILES[\s\S]*?metadata\.nlink !== 1[\s\S]*?MAX_THEME_FONT_BYTES[\s\S]*?copyFile/,
    'only the exact bounded licensed theme font set may be copied into the deployable client',
  );
  const workerFirstSource = /run_worker_first:\s*\[([\s\S]*?)\]/.exec(viteConfig)?.[1];
  assert.ok(workerFirstSource, 'vite.config.ts must define an explicit run_worker_first route list');
  const workerFirstRoutes = [...workerFirstSource.matchAll(/['"]([^'"]+)['"]/g)].map(
    match => match[1],
  );
  assert.deepEqual(workerFirstRoutes, [
    '/api/admin/preview-assets/*',
    '/api/admin/core-datasets/*',
    '/api/admin/dataset-channels/*',
    '/api/admin/migration/*',
    '/api/datasets',
    '/api/export-failures',
    '/api/feedback',
    '/api/recipe-favorites*',
    '/api/auth/*',
    '/api/donations*',
    '/api/modpacks*',
    '/dataset/publications/*',
    '/dataset/preview-sets/*',
  ]);
  assert.doesNotMatch(
    viteConfig,
    /run_worker_first:\s*true/,
    'unrelated hashed application assets should retain the lower-overhead asset-first path',
  );
  assert.match(
    viteConfig,
    /cache:\s*\{\s*enabled:\s*true\s*\}/,
    'immutable Worker responses must use Cloudflare Workers Caching at the edge',
  );
  assert.match(
    viteConfig,
    /r2_buckets:\s*isCloudflareProduction[\s\S]*?:\s*!isCloudflareBeta\s*&&\s*hostingConfig\.r2[\s\S]*?binding:\s*hostingConfig\.r2[\s\S]*?bucket_name:\s*['"]site-creator-r2['"]/,
    'the temporary migration build must retain the Sites-managed source R2 binding',
  );
  for (const header of [
    'Content-Security-Policy',
    'Permissions-Policy',
    'Referrer-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
  ]) {
    assert.match(
      sitesVitePlugin,
      new RegExp(`${header}:`),
      `static responses must declare ${header}`,
    );
  }
  assert.match(
    sitesVitePlugin,
    /\/assets\/\*[\s\S]*?max-age=31536000,\s*immutable/,
    'content-hashed client assets should be cached immutably',
  );
  assert.match(
    viteConfig,
    /sites\(\{connectSrcOrigins:\s*\[SUPABASE_URL\]\}\)/,
    'static viewer responses must allow the configured Supabase OAuth origin',
  );
  assert.match(
    sitesVitePlugin,
    /connectSrcOrigins\.map\(requireHttpsOrigin\)/,
    'static CSP additions must be validated as exact HTTPS origins',
  );
});

test('the graph implementation is deferred until the recipe index is requested', () => {
  assert.doesNotMatch(
    applicationSource,
    /import\s+\{\s*GraphScreen\s*\}\s+from/,
    'the graph renderer must not remain on the initial item-browser dependency path',
  );
  assert.match(
    applicationSource,
    /React\.lazy\([\s\S]*?import\(['"]\.\/src\/graph\/GraphScreen['"]\)/,
    'the graph renderer should load in a separate on-demand chunk',
  );
});

test('the client derives catalog-bound publication and preview-set routes', () => {
  assert.match(
    datasetCatalogContext,
    /return \{catalogUrl: ['"]\/api\/datasets['"], assetOrigin: ['"]['"]\};/,
    'web clients must load the same-origin immutable dataset catalog',
  );
  assert.match(
    datasetCatalog,
    /base:\s*`\$\{prefix\}\/dataset\/publications\/\$\{descriptor\.publicationId\}\/exports`/,
    'core exports must be scoped by the selected publication ID',
  );
  assert.match(
    datasetCatalog,
    /previewBase:\s*`\$\{prefix\}\/dataset\/preview-sets\/\$\{descriptor\.previewAssetSetId\}`/,
    'recipe previews must be scoped by the selected preview asset-set ID',
  );
  assert.doesNotMatch(
    datasetCatalog,
    /\/dataset\/(?:exports|previews)(?:\/|['"`])/,
    'the client must not retain retired process-global dataset routes',
  );
});

test('the environment template exposes only the current server-side operator contract', () => {
  const entries = [...environmentExample.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)];
  const values = Object.fromEntries(entries.map(([, name, value]) => [name, value]));
  assert.deepEqual(Object.keys(values), [
    'BETA_DATA_ORIGIN',
    'DATASET_ADMIN_ENABLED',
    'CORE_DATASET_UPLOAD_TOKEN',
    'PREVIEW_UPLOAD_ENABLED',
    'PREVIEW_UPLOAD_ASSET_SET_ID',
    'PREVIEW_UPLOAD_TOKEN',
    'FEEDBACK_ADMIN_TOKEN',
    'GITHUB_ISSUES_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'DONATION_SUPABASE_MONTHLY_CENTS',
    'DONATION_CLOUDFLARE_MONTHLY_CENTS',
    'DONATION_GITHUB_ACTIONS_MONTHLY_CENTS',
  ]);
  assert.equal(values.BETA_DATA_ORIGIN, 'https://minecraftrecipetree.craftsmannsoftware.com');
  assert.equal(values.DATASET_ADMIN_ENABLED, 'false');
  assert.equal(values.PREVIEW_UPLOAD_ENABLED, 'false');
  assert.ok(values.CORE_DATASET_UPLOAD_TOKEN.length >= 32);
  assert.doesNotMatch(values.CORE_DATASET_UPLOAD_TOKEN, /[\s\u0000-\u001f\u007f]/);
  assert.ok(values.PREVIEW_UPLOAD_TOKEN.length >= 32);
  assert.ok(values.FEEDBACK_ADMIN_TOKEN.length >= 32);
  assert.doesNotMatch(values.FEEDBACK_ADMIN_TOKEN, /[\s\u0000-\u001f\u007f]/);
  assert.ok(values.GITHUB_ISSUES_TOKEN.length >= 32);
  assert.doesNotMatch(values.GITHUB_ISSUES_TOKEN, /[\s\u0000-\u001f\u007f]/);
  assert.equal(values.SUPABASE_URL, 'https://replace-with-project-ref.supabase.co');
  assert.equal(values.SUPABASE_SECRET_KEY, 'sb_secret_replace_with_server_secret');
  assert.match(values.STRIPE_SECRET_KEY, /^sk_test_/);
  assert.match(values.STRIPE_WEBHOOK_SECRET, /^whsec_/);
  for (const name of [
    'DONATION_SUPABASE_MONTHLY_CENTS',
    'DONATION_CLOUDFLARE_MONTHLY_CENTS',
    'DONATION_GITHUB_ACTIONS_MONTHLY_CENTS',
  ]) {
    assert.match(values[name], /^\d+$/);
  }
  assert.doesNotMatch(environmentExample, /^PREVIEW_ASSET_SET_ID=/m);
  assert.doesNotMatch(environmentExample, /^EXPO_PUBLIC_.*TOKEN=/m);
});

test('D1 migrations are idempotent with the Worker runtime schema initializer', () => {
  for (const migration of d1Migrations) {
    assert.doesNotMatch(
      migration,
      /CREATE\s+(?:UNIQUE\s+INDEX|TABLE)\s+(?!IF\s+NOT\s+EXISTS)/i,
      'checked-in migrations must not fail when an identical runtime-initialized object exists',
    );
  }
});
