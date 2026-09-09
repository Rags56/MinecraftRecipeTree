const SITES_COMPATIBILITY_ORIGIN =
  'https://minecraft-recipe-tree.gtjoe51.chatgpt.site';
const CLOUDFLARE_PRODUCTION_ORIGIN =
  'https://minecraft-recipe-tree-production.gtjoe51.workers.dev';

export const APP_ROUTES = Object.freeze({
  'minecraftrecipetree.craftsmannsoftware.com': Object.freeze({
    serviceBinding: 'MINECRAFT_RECIPE_TREE',
    compatibilityOrigin: SITES_COMPATIBILITY_ORIGIN,
    deployedOrigin: CLOUDFLARE_PRODUCTION_ORIGIN,
  }),
  'churchcore.craftsmannsoftware.com': Object.freeze({
    origin: 'https://churchcore.pages.dev',
  }),
  'contractoros.craftsmannsoftware.com': Object.freeze({
    origin: 'https://contractoros.pages.dev',
    defaultPath: '/features/',
    bodyRewrites: Object.freeze([
      Object.freeze([
        'https://craftsmannsoftware.com/contractoros',
        'https://contractoros.craftsmannsoftware.com',
      ]),
    ]),
  }),
  'schedulingtemplate.craftsmannsoftware.com': Object.freeze({
    origin: 'https://schedulingtemplate.pages.dev',
  }),
});

const TEXT_CONTENT_TYPES = Object.freeze([
  'text/html',
  'text/css',
  'application/javascript',
  'text/javascript',
  'application/json',
  'application/manifest+json',
]);

export function shouldRewriteBody(contentType = '') {
  return TEXT_CONTENT_TYPES.some((type) =>
    contentType.toLowerCase().includes(type),
  );
}

export function rewriteLocation(location, route, publicOrigin) {
  if (!location) return location;
  const routeOrigin = route.origin ?? route.deployedOrigin;
  try {
    const resolvedLocation = new URL(location, routeOrigin);
    if (resolvedLocation.origin !== routeOrigin) return location;
    return `${publicOrigin}${resolvedLocation.pathname}${resolvedLocation.search}${resolvedLocation.hash}`;
  } catch (error) {
    console.error('Failed to rewrite an app-subdomain redirect.', {
      location,
      origin: routeOrigin,
      error: error instanceof Error ? error.message : String(error),
    });
    return location;
  }
}

async function fetchRoute(request, route, env) {
  if (route.serviceBinding) {
    const service = env[route.serviceBinding];
    if (!service || typeof service.fetch !== 'function') {
      throw new Error(`Missing service binding: ${route.serviceBinding}`);
    }
    return service.fetch(request);
  }

  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(route.origin);
  upstreamUrl.pathname = requestUrl.pathname;
  upstreamUrl.search = requestUrl.search;
  return fetch(new Request(upstreamUrl, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = APP_ROUTES[url.hostname.toLowerCase()];
    if (!route) {
      console.error('No app-subdomain origin is configured.', {
        hostname: url.hostname,
      });
      return new Response('Unknown app subdomain', { status: 404 });
    }

    if (route.defaultPath && url.pathname === '/') {
      return Response.redirect(
        `${url.origin}${route.defaultPath}${url.search}`,
        308,
      );
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetchRoute(request, route, env);
    } catch (error) {
      console.error('App-subdomain origin request failed.', {
        hostname: url.hostname,
        upstream: route.deployedOrigin ?? route.origin,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response('App origin unavailable', { status: 502 });
    }

    const headers = new Headers(upstreamResponse.headers);
    // The signal-edge Worker uses this legacy value as its routing contract.
    // Keep it stable during the rollback window while separately exposing the
    // actual Cloudflare destination below.
    headers.set(
      'x-craftsmann-app-origin',
      route.compatibilityOrigin ?? route.origin,
    );
    if (route.deployedOrigin) {
      headers.set('x-craftsmann-worker-origin', route.deployedOrigin);
    }

    const rewrittenLocation = rewriteLocation(
      headers.get('location'),
      route,
      url.origin,
    );
    if (rewrittenLocation) headers.set('location', rewrittenLocation);

    const contentType = headers.get('content-type') || '';
    if (!shouldRewriteBody(contentType)
      || (route.serviceBinding && !contentType.toLowerCase().includes('text/html'))) {
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers,
      });
    }

    headers.delete('content-length');
    let body = await upstreamResponse.text();
    const routeOrigin = route.origin ?? route.deployedOrigin;
    body = body.replaceAll(routeOrigin, url.origin);
    for (const [from, to] of route.bodyRewrites || []) {
      body = body.replaceAll(from, to);
    }
    return new Response(body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  },
};
