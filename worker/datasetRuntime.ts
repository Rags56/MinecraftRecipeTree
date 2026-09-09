import type {PreviewUploadR2Bucket} from './previewAssetUpload.ts';

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: {changes?: number};
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

declare global {
  interface CacheStorage {
    /** The Workers runtime's shared, edge-local cache; not part of the standard DOM lib types. */
    default: Cache;
  }
}

export interface DatasetR2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

export interface DatasetR2Object {
  key: string;
  size: number;
  etag?: string;
  range?: DatasetR2Range;
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface DatasetR2Bucket extends PreviewUploadR2Bucket {
  get(
    key: string,
    options?: {range?: {offset: number; length: number}},
  ): Promise<DatasetR2Object | null>;
}

export interface DatasetRuntime {
  DATASET_RESPONSE_CACHE?: string;
  ASSETS?: {fetch(request: Request): Promise<Response>};
  DB?: D1Database;
  /** Existing Sites binding; core publications use the isolated `core/` prefix. */
  PREVIEW_ASSETS?: DatasetR2Bucket;
  /** Beta-only read origin for the public, immutable production dataset corpus. */
  BETA_DATA_ORIGIN?: string;
  /** Optional beta-only immutable candidate substituted into one catalog descriptor. */
  BETA_CANDIDATE_DATASET_SLUG?: string;
  BETA_CANDIDATE_PUBLICATION_ID?: string;
  BETA_CANDIDATE_PREVIEW_ASSET_SET_ID?: string;
  BETA_CANDIDATE_PACK_VERSION?: string;
  DATASET_ADMIN_ENABLED?: string;
  CORE_DATASET_UPLOAD_TOKEN?: string;
  PREVIEW_UPLOAD_ASSET_SET_ID?: string;
  PREVIEW_UPLOAD_ENABLED?: string;
  PREVIEW_UPLOAD_TOKEN?: string;
  FEEDBACK_ADMIN_TOKEN?: string;
  /** Server-only token with Issues: write and Contents: write access to the application repo. */
  GITHUB_ISSUES_TOKEN?: string;
  /** Hosted Supabase project used to verify account access tokens. */
  SUPABASE_URL?: string;
  /** Server-only Supabase secret key used only for destructive Auth administration. */
  SUPABASE_SECRET_KEY?: string;
  /** Server-only Stripe credentials used for hosted donation Checkout and signed webhooks. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Monthly operating budgets; the public meter resets at the start of each UTC month. */
  DONATION_SUPABASE_MONTHLY_CENTS?: string;
  DONATION_CLOUDFLARE_MONTHLY_CENTS?: string;
  DONATION_GITHUB_ACTIONS_MONTHLY_CENTS?: string;
  /** Short-lived, server-only credentials used only while migrating away from Sites storage. */
  MIGRATION_EXPORT_TOKEN?: string;
  MIGRATION_IMPORT_TOKEN?: string;
}

export function noStoreJson(value: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function methodNotAllowed(allow: string): Response {
  return new Response('Method not allowed', {
    status: 405,
    headers: {'Allow': allow, 'Cache-Control': 'no-store'},
  });
}

export async function tokensEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function authorizeDatasetAdmin(
  request: Request,
  adminEnabled: string | undefined,
  configuredToken: string | undefined,
): Promise<Response | null> {
  if (adminEnabled !== 'true') {
    console.error('Dataset administration is disabled because DATASET_ADMIN_ENABLED is not true.');
    return noStoreJson({error: 'Dataset administration is disabled.'}, 503);
  }
  if (!configuredToken) {
    console.error('Dataset administration is disabled because CORE_DATASET_UPLOAD_TOKEN is unset.');
    return noStoreJson({error: 'Dataset administration is disabled.'}, 503);
  }
  if (
    configuredToken.length < 32 ||
    new TextEncoder().encode(configuredToken).byteLength > 8192 ||
    /[\s\u0000-\u001f\u007f]/.test(configuredToken)
  ) {
    console.error('CORE_DATASET_UPLOAD_TOKEN does not satisfy the strict 32-8192 byte format.');
    return noStoreJson({error: 'Dataset administration is misconfigured.'}, 503);
  }
  const authorization = request.headers.get('authorization');
  const candidate = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (
    !candidate ||
    candidate.length > 8192 ||
    /[\s\u0000-\u001f\u007f]/.test(candidate) ||
    !(await tokensEqual(candidate, configuredToken))
  ) {
    console.warn('A dataset administration request failed bearer-token authentication.', {
      method: request.method,
      path: new URL(request.url).pathname,
    });
    return new Response('Unauthorized', {
      status: 401,
      headers: {
        'Cache-Control': 'no-store',
        'WWW-Authenticate': 'Bearer realm="core-datasets"',
      },
    });
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function parseBoundedContentLength(request: Request, maximum: number): number | null {
  const raw = request.headers.get('content-length');
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximum ? value : null;
}
