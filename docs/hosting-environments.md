# Hosting environments

Minecraft Recipe Tree uses a beta Cloudflare Worker for live testing before an explicitly approved
production release. Production runs on normal Cloudflare Worker, D1, and R2 resources without
changing the canonical public hostname. The former OpenAI Sites deployment is temporarily retained
only as the rollback snapshot for the migration soak.

| Environment | Source branch | Runtime | URL | Access |
| --- | --- | --- | --- | --- |
| Beta | `beta` | Worker `minecraft-recipe-tree-beta` | [minecraft-recipe-tree-beta.gtjoe51.workers.dev](https://minecraft-recipe-tree-beta.gtjoe51.workers.dev/) | Private release candidate |
| Production | `main` | Worker `minecraft-recipe-tree-production` | [minecraftrecipetree.craftsmannsoftware.com](https://minecraftrecipetree.craftsmannsoftware.com/) | Public |
| Rollback source | `main` migration snapshot | Sites `appgprj_6a5a5da437248191a0f8accf3fb92d5d` | `minecraft-recipe-tree.gtjoe51.chatgpt.site` | Temporary |

The canonical hostname remains in the existing `craftsmann-subdomain-signal` and
`craftsmann-app-subdomain-router` chain. At cutover, the app router uses a service binding to the
standalone production Worker. DNS does not change.

The canonical beta endpoint is `https://minecraft-recipe-tree-beta.gtjoe51.workers.dev`. Use it for
all beta acceptance testing and links. The previous `chatgpt.site` beta endpoint and the obsolete
`https://minecraftrecipetree.pages.dev` export are not the active beta application.

## Branch-specific configuration

The `beta` branch retains `.openai/hosting.json` only so the temporary Sites migration bridge can be
built from the same application. Active beta releases always use `npm run deploy:cloudflare-beta`.
Standalone production releases use `npm run deploy:cloudflare-production` and bind native
Cloudflare resources directly.

Do not use `.openai/hosting.json` for beta or standalone production releases. Do not attach the
canonical hostname directly to Sites or the application Worker, and do not change its DNS record.

## Beta data access

The beta Worker has this environment variable:

```text
BETA_DATA_ORIGIN=https://minecraftrecipetree.craftsmannsoftware.com
```

The beta Worker uses that origin only for public, read-only access to the dataset catalog, immutable
publications, immutable preview sets, and legacy modpack verification. It must strip cookies and
authorization and refuse feedback, administration, and mutation requests. This lets a private beta
exercise production-shaped data without sharing production bindings or accepting writes.

### Local testing against public data

`vite dev` sets the same variable for the local Worker, so a development server reads real packs.
A built Worker served by `wrangler dev` does not, and on web the client asks its own origin for the
catalog -- a local D1 holds no published dataset, so that request answers 503 and the app offers no
modpacks at all. Build with `npm run build:local` (`MRT_LOCAL_DATA_ORIGIN=true`) to give the built
Worker the same read-only origin:

```sh
npm run build:local
npx wrangler dev --config dist/server/wrangler.json --port 8790
```

The flag is ignored when `MRT_DEPLOY_TARGET` selects beta or production, which have datasets of
their own. Use the ordinary `npm run build` when testing the local database itself.

## Release workflow

1. Reconcile the latest `main` application changes into `beta` while retaining the beta project ID
   and beta-only data proxy.
2. Implement and validate the change on `beta`.
3. Mirror the exact tested commit into `Filostorm/CraftsmannSoftware` and deploy it with
   `npm run deploy:cloudflare-beta` from `sites/minecraft-recipe-tree`.
4. Verify the beta page hydrates in a fresh browser tab, the changed feature works, a hashed
   application asset loads, and `/api/datasets` returns
   `X-MRT-Beta-Data-Origin: https://minecraftrecipetree.craftsmannsoftware.com`.
5. Share the Cloudflare beta URL for acceptance testing. A successful beta deployment does not
   authorize a production release.
6. After explicit production approval, transfer the exact validated application changes to `main`.
7. Build and deploy with `npm run deploy:cloudflare-production`, then perform every production
   check listed in `AGENTS.md`.

## Sites-to-Cloudflare storage migration

The temporary authenticated bridge at `/api/admin/migration/*` exports only the allowlisted D1
tables and R2 objects. Export and import credentials are independent, server-only, and must be
removed after the rollback soak.

1. Apply `drizzle/` migrations to D1 `minecraft-recipe-tree-production`.
2. Enable R2 and create `minecraft-recipe-tree-production-assets`.
3. Deploy the bridge once to the Sites rollback source with `MIGRATION_EXPORT_TOKEN`.
4. Deploy the standalone Worker with `MIGRATION_IMPORT_TOKEN`, `FEEDBACK_ADMIN_TOKEN`, and
   `GITHUB_ISSUES_TOKEN` secrets.
5. Use `npm run migrate:sites-storage -- export-db ...` and import the resulting SQL into D1.
6. Use `npm run migrate:sites-storage -- copy-r2 ...`. The copy is checksum-enforced,
   metadata-preserving, bounded-concurrency, and resumable.
7. Briefly freeze source writes, repeat the database export/import and object copy, and compare row
   counts plus the complete R2 key/size/metadata inventory.
8. Verify reads, a staged upload, feedback, and deduplicated failure reporting against the direct
   production Worker.
9. Update the app router service binding, verify the canonical hostname, then leave Sites intact
   during the rollback soak. Remove migration secrets immediately after the soak; retire Sites only
   after the acceptance record is complete.

If beta validation fails, fix and redeploy beta. Do not silently fall back to an older beta or
promote an unverified commit.
