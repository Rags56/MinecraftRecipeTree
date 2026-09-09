import vinext from 'vinext';
import {defineConfig} from 'vite';
import hostingConfig from './.openai/hosting.json';
import {sites} from './build/sites-vite-plugin';
import {SUPABASE_PROJECT_URL} from './src/account/supabaseConfig';

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
const isCloudflareBeta = process.env.MRT_DEPLOY_TARGET === 'cloudflare-beta';
const isCloudflareProduction = process.env.MRT_DEPLOY_TARGET === 'cloudflare-production';
const BETA_DATA_ORIGIN = 'https://minecraftrecipetree.craftsmannsoftware.com';
const SUPABASE_URL = SUPABASE_PROJECT_URL;
const BETA_CANDIDATE_DATASET_SLUG = 'gt-new-horizons';
const BETA_CANDIDATE_PUBLICATION_ID =
  '645b42d21ecb44a6e844cdbd02a88266b6123039557cf7aa49321c06d35c0b0f';
const BETA_CANDIDATE_PREVIEW_ASSET_SET_ID =
  '75a9410ccc9c90813140ce8d22b6380a4f441e2a23f989182de92e31dc13487d';
const BETA_CANDIDATE_PACK_VERSION = '2.8.4';
const DONATION_GITHUB_ACTIONS_MONTHLY_CENTS = '400';
const DONATION_CLOUDFLARE_MONTHLY_CENTS = '500';
const DONATION_SUPABASE_MONTHLY_CENTS = '2500';
const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = '00000000-0000-4000-8000-000000000000';
const CLOUDFLARE_BETA_DATABASE_ID = '8e0218ae-8adc-4a3b-a381-c11020757009';
const CLOUDFLARE_BETA_DATABASE_NAME = 'minecraft-recipe-tree-beta';
const CLOUDFLARE_PRODUCTION_DATABASE_ID = 'e6624ef2-8bd9-49e5-8d32-0671351c61c3';
const CLOUDFLARE_PRODUCTION_DATABASE_NAME = 'minecraft-recipe-tree-production';
const CLOUDFLARE_PRODUCTION_BUCKET_NAME = 'minecraft-recipe-tree-production-assets';

export default defineConfig(async ({command}) => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  const isLocalDev = command === 'serve' && !isCloudflareBeta && !isCloudflareProduction;

  const {cloudflare} = await import('@cloudflare/vite-plugin');

  return {
    // Complete recipe publications are served from the Sites-managed R2 binding. Curated static
    // application files are copied individually by sites-vite-plugin.ts so an accidental
    // public/exports corpus can never be swept into an application deployment.
    publicDir: false as const,
    resolve: {
      alias: {
        'react-native': 'react-native-web',
      },
    },
    server: isCodexSeatbeltSandbox
      ? {watch: {useFsEvents: false, usePolling: true}}
      : undefined,
    plugins: [
      vinext(),
      sites({connectSrcOrigins: [SUPABASE_URL]}),
      cloudflare({
        viteEnvironment: {name: 'rsc', childEnvironments: ['ssr']},
        config: {
          ...(isCloudflareBeta
            ? {
                name: 'minecraft-recipe-tree-beta',
                vars: {
                  BETA_DATA_ORIGIN,
                  DATASET_RESPONSE_CACHE: 'true',
                  SUPABASE_URL,
                  BETA_CANDIDATE_DATASET_SLUG,
                  BETA_CANDIDATE_PUBLICATION_ID,
                  BETA_CANDIDATE_PREVIEW_ASSET_SET_ID,
                  BETA_CANDIDATE_PACK_VERSION,
                  DONATION_GITHUB_ACTIONS_MONTHLY_CENTS,
                  DONATION_CLOUDFLARE_MONTHLY_CENTS,
                  DONATION_SUPABASE_MONTHLY_CENTS,
                },
              }
            : isCloudflareProduction
              ? {
                  name: 'minecraft-recipe-tree-production',
                  vars: {
                    DATASET_ADMIN_ENABLED: 'true',
                    DATASET_RESPONSE_CACHE: 'true',
                    SUPABASE_URL,
                    DONATION_GITHUB_ACTIONS_MONTHLY_CENTS,
                    DONATION_CLOUDFLARE_MONTHLY_CENTS,
                    DONATION_SUPABASE_MONTHLY_CENTS,
                  },
                }
              : isLocalDev
                ? {vars: {BETA_DATA_ORIGIN}}
                : {}),
          main: './worker/index.ts',
          compatibility_flags: ['nodejs_compat'],
          cache: {enabled: true},
          observability: {enabled: true, logs: {enabled: true, invocation_logs: false}},
          assets: {
            binding: 'ASSETS',
            run_worker_first: [
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
            ],
          },
          d1_databases: isCloudflareBeta
            ? [
                {
                  binding: 'DB',
                  database_name: CLOUDFLARE_BETA_DATABASE_NAME,
                  database_id: CLOUDFLARE_BETA_DATABASE_ID,
                  migrations_dir: 'drizzle',
                },
              ]
            : isCloudflareProduction
            ? [
                {
                  binding: 'DB',
                  database_name: CLOUDFLARE_PRODUCTION_DATABASE_NAME,
                  database_id: CLOUDFLARE_PRODUCTION_DATABASE_ID,
                  migrations_dir: 'drizzle',
                },
              ]
            : !isCloudflareBeta && hostingConfig.d1
            ? [
                {
                  binding: hostingConfig.d1,
                  database_name: 'minecraft-recipe-tree-d1',
                  database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
                },
              ]
            : [],
          r2_buckets: isCloudflareProduction
            ? [
                {
                  binding: 'PREVIEW_ASSETS',
                  bucket_name: CLOUDFLARE_PRODUCTION_BUCKET_NAME,
                },
              ]
            : !isCloudflareBeta && hostingConfig.r2
            ? [
                {
                  binding: hostingConfig.r2,
                  bucket_name: 'site-creator-r2',
                },
              ]
            : [],
        },
      }),
    ],
    define: {
      __DEV__: JSON.stringify(false),
    },
  };
});
