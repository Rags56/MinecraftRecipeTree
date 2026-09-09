// Cache only successful public immutable dataset responses, after the delivery
// layer has checked the committed manifest, object hash and image coordinates.
// Exact query strings remain part of the key; malformed variants never alias a
// validated response. Public dataset responses do not vary with credentials.
export async function cachedDatasetResponse(
  request: Request,
  load: () => Promise<Response>,
  ctx: {waitUntil(promise: Promise<unknown>): void},
  cache?: Cache,
): Promise<Response> {
  const url = new URL(request.url);
  if (!/^\/dataset\/(publications|preview-sets)\/[a-f0-9]{64}\//.test(url.pathname)
    || !['GET', 'HEAD'].includes(request.method)) return load();
  if (!cache) {
    try { cache = globalThis.caches?.default; }
    catch (error) { console.error('Dataset response cache access failed.', error); }
  }
  if (!cache) {
    console.warn('Dataset response cache is unavailable; validated storage delivery is required.');
    return load();
  }
  // Range/conditional headers are deliberately excluded. The delivery layer
  // exposes image coordinates in the URL and always returns whole HTTP bodies.
  const key = new Request(request.url, {method: 'GET'});
  try {
    const hit = await cache.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('X-Dataset-Cache', 'HIT');
      return new Response(request.method === 'HEAD' ? null : hit.body, {status: hit.status, headers});
    }
  } catch (error) {
    console.error('Dataset response cache lookup failed.', error);
  }
  const response = await load();
  const policy = response.headers.get('Cache-Control') ?? '';
  if (request.method === 'GET' && response.status === 200
    && /\bpublic\b/.test(policy) && /\bimmutable\b/.test(policy)
    && !response.headers.has('Set-Cookie') && !response.headers.has('Vary')) {
    ctx.waitUntil(cache.put(key, response.clone()).catch(error => {
      console.error('Dataset response cache write failed.', error);
    }));
  }
  const headers = new Headers(response.headers);
  headers.set('X-Dataset-Cache', 'MISS');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}
