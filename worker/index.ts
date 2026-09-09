import {cachedDatasetResponse} from './datasetResponseCache.ts';
import handler from 'vinext/server/app-router-entry';
import {proxyBetaDatasetRequest} from './betaDataProxy.ts';
import {CORE_DATASET_UPLOAD_BASE_PATH, handleCoreDatasetUpload} from './coreDatasetUpload.ts';
import {
  CORE_PUBLIC_ROUTE,
  PREVIEW_PUBLIC_ROUTE,
  handleCoreDatasetRead,
  handlePreviewDatasetRead,
  verifyCommittedDatasetPair,
} from './datasetDelivery.ts';
import {
  DATASET_CHANNEL_ACTIVATION_ROUTE,
  DATASET_CHANNEL_DELETION_ROUTE,
  handleDatasetCatalog,
  handleDatasetChannelActivation,
  handleDatasetChannelDeletion,
} from './datasetRegistry.ts';
import {type DatasetRuntime, methodNotAllowed, noStoreJson} from './datasetRuntime.ts';
import {
  PREVIEW_UPLOAD_BASE_PATH,
  handlePreviewAssetUpload,
} from './previewAssetUpload.ts';
import {FEEDBACK_ROUTE, handleFeedback} from './feedback.ts';
import {EXPORT_FAILURE_ROUTE, handleExportFailureIssue} from './exportFailureIssue.ts';
import {MIGRATION_BASE_PATH, handleStorageMigration} from './migration.ts';
import {RECIPE_FAVORITES_ROUTE, handleRecipeFavorites} from './recipeFavorites.ts';
import {
  RECIPE_RETENTION_REPORTS_ROUTE,
  handleRecipeRetentionReports,
} from './recipeRetentionReports.ts';
import {AUTH_ROUTE_PREFIX, handleUserAccounts, supabaseProjectUrl} from './userAccounts.ts';
import {DONATIONS_ROUTE, handleDonations} from './donations.ts';

const PERMISSIONS_POLICY =
  'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()';

function contentSecurityPolicy(runtime: DatasetRuntime): string {
  let supabaseOrigin = '';
  if (runtime.SUPABASE_URL) {
    try {
      supabaseOrigin = ` ${supabaseProjectUrl(runtime.SUPABASE_URL)}`;
    } catch (error) {
      console.error('The configured Supabase origin could not be added to browser connections.', error);
    }
  }
  return (
    `default-src 'self'; base-uri 'self'; connect-src 'self' https://metrics.craftsmannsoftware.com${supabaseOrigin}; ` +
    "font-src 'self' data:; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; " +
    "object-src 'none'; script-src 'self' 'unsafe-inline' https://metrics.craftsmannsoftware.com; " +
    "style-src 'self' 'unsafe-inline'; worker-src 'self' blob:"
  );
}

interface LegacyModpackRow {
  id: string;
  name: string;
  minecraft_version: string;
  snapshot_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

function serializeLegacyModpack(row: LegacyModpackRow) {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.snapshot_json) as unknown;
  } catch (error) {
    console.error('A legacy modpack row contains invalid snapshot JSON.', {id: row.id, error});
    throw error;
  }
  return {
    id: row.id,
    name: row.name,
    minecraftVersion: row.minecraft_version,
    snapshot,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function handleLegacyModpackApi(
  request: Request,
  runtime: DatasetRuntime,
  pathname: string,
): Promise<Response> {
  if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE') {
    console.warn('An unauthenticated legacy modpack mutation was refused.', {
      method: request.method,
      pathname,
    });
    return noStoreJson(
      {error: 'Modpack mutations are disabled; use authenticated immutable publication activation.'},
      403,
    );
  }
  if (request.method !== 'GET') return methodNotAllowed('GET');
  if (pathname !== '/api/modpacks') return noStoreJson({error: 'Not found.'}, 404);
  const db = runtime.DB;
  if (!db) {
    console.error('Legacy modpack GET cannot read because the DB binding is unavailable.');
    return noStoreJson({error: 'Modpack storage is unavailable.'}, 503);
  }
  try {
    const rows = await db
      .prepare('SELECT * FROM modpacks ORDER BY updated_at DESC')
      .all<LegacyModpackRow>();
    if (!rows.success) throw new Error('D1 reported an unsuccessful legacy modpack query.');
    return noStoreJson({modpacks: (rows.results ?? []).map(serializeLegacyModpack)});
  } catch (error) {
    console.error('Legacy modpack GET failed.', error);
    return noStoreJson({error: 'Modpack storage is unavailable.'}, 503);
  }
}

function withSecurityHeaders(
  request: Request,
  response: Response,
  runtime: DatasetRuntime,
): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', contentSecurityPolicy(runtime));
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', PERMISSIONS_POLICY);
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  if (new URL(request.url).protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  const bodyForbidden =
    request.method === 'HEAD' ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304;
  return new Response(bodyForbidden ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function dispatchRequest(
  request: Request,
  env: Parameters<typeof handler.fetch>[1],
  ctx: Parameters<typeof handler.fetch>[2],
): Promise<Response> {
  const runtime = (env ?? {}) as DatasetRuntime;
  const url = new URL(request.url);
  const betaDataResponse = await proxyBetaDatasetRequest(request, runtime, url);
  if (betaDataResponse) return betaDataResponse;

  if (url.pathname.startsWith(PREVIEW_UPLOAD_BASE_PATH)) {
    return handlePreviewAssetUpload(request, runtime, url);
  }
  if (url.pathname.startsWith(CORE_DATASET_UPLOAD_BASE_PATH)) {
    return handleCoreDatasetUpload(request, runtime, url);
  }
  if (DATASET_CHANNEL_ACTIVATION_ROUTE.test(url.pathname)) {
    return handleDatasetChannelActivation(
      request,
      runtime,
      url,
      (publicationId, previewAssetSetId) =>
        verifyCommittedDatasetPair(runtime, publicationId, previewAssetSetId),
    );
  }
  if (DATASET_CHANNEL_DELETION_ROUTE.test(url.pathname)) {
    return handleDatasetChannelDeletion(request, runtime, url);
  }
  if (url.pathname === '/api/datasets') {
    return handleDatasetCatalog(request, runtime);
  }
  if (url.pathname === FEEDBACK_ROUTE) {
    return handleFeedback(request, runtime, url);
  }
  if (url.pathname === EXPORT_FAILURE_ROUTE) {
    return handleExportFailureIssue(request, runtime, url);
  }
  if (
    url.pathname === RECIPE_FAVORITES_ROUTE ||
    url.pathname.startsWith(`${RECIPE_FAVORITES_ROUTE}/`)
  ) {
    return handleRecipeFavorites(request, runtime, url);
  }
  if (url.pathname === RECIPE_RETENTION_REPORTS_ROUTE) {
    return handleRecipeRetentionReports(request, runtime, url);
  }
  if (url.pathname.startsWith(AUTH_ROUTE_PREFIX)) {
    return handleUserAccounts(request, runtime, url);
  }
  if (url.pathname === DONATIONS_ROUTE || url.pathname.startsWith(`${DONATIONS_ROUTE}/`)) {
    return handleDonations(request, runtime, url);
  }
  if (url.pathname.startsWith(MIGRATION_BASE_PATH)) {
    return handleStorageMigration(request, runtime, url);
  }
  if (url.pathname === '/api/modpacks' || url.pathname.startsWith('/api/modpacks/')) {
    return handleLegacyModpackApi(request, runtime, url.pathname);
  }

  const coreMatch = CORE_PUBLIC_ROUTE.exec(url.pathname);
  if (coreMatch) {
    return handleCoreDatasetRead(request, runtime, url, coreMatch);
  }
  const previewMatch = PREVIEW_PUBLIC_ROUTE.exec(url.pathname);
  if (previewMatch) {
    return handlePreviewDatasetRead(request, runtime, url, previewMatch);
  }

  // These paths depended on a process-global PREVIEW_ASSET_SET_ID/static snapshot. Keeping an
  // explicit tombstone prevents old clients from silently mixing datasets after migration.
  if (
    url.pathname.startsWith('/dataset/exports/') ||
    url.pathname.startsWith('/dataset/previews/')
  ) {
    console.warn('A retired single-dataset route was requested.', {pathname: url.pathname});
    return new Response('Single-dataset route retired; refresh the application', {
      status: 410,
      headers: {'Cache-Control': 'no-store'},
    });
  }

  const response = await handler.fetch(request, env, ctx);
  if (response.headers.has('cache-control')) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(
    request: Request,
    env: Parameters<typeof handler.fetch>[1],
    ctx: Parameters<typeof handler.fetch>[2],
  ): Promise<Response> {
    const runtime = (env ?? {}) as DatasetRuntime;
    try {
      return withSecurityHeaders(request, await (runtime.DATASET_RESPONSE_CACHE === 'true'
        ? cachedDatasetResponse(request, () => dispatchRequest(request, env, ctx), ctx)
        : dispatchRequest(request, env, ctx)), runtime);
    } catch (error) {
      console.error('Minecraft Recipe Tree request failed closed.', error);
      return withSecurityHeaders(request, noStoreJson({error: 'Request failed.'}, 500), runtime);
    }
  },
};

export default worker;
