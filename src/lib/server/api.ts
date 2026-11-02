/**
 * Shared by the endpoints of Alleda's API under /api/v1/ (docs/API.md):
 * JSON answers, errors in one shape, and CORS for the origins of the
 * calling key.
 *
 * CORS: a preflight (OPTIONS) carries no Authorization header, so it cannot
 * know the key and lets every origin ask. The real request answers with
 * Access-Control-Allow-Origin only for an origin the key lists, and a
 * request from any other origin is refused (403), so a key copied from one
 * website does not work on another site's pages. Servers send no Origin and
 * are not affected; the key is their only check.
 */

const BASE_HEADERS = {
  'X-Robots-Tag': 'noindex',
  // The answer depends on the key and the origin
  Vary: 'Authorization, Origin'
};

export type ApiErrorCode =
  'unauthorized' | 'origin_not_allowed' | 'invalid_request' | 'unavailable' | 'not_found';

function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Type' }
    : {};
}

/** A JSON answer; corsOrigin: the request's origin when the key allows it */
export function apiJson(
  body: unknown,
  init: { status?: number; corsOrigin?: string | null; cacheSeconds?: number } = {}
): Response {
  const { status = 200, corsOrigin = null, cacheSeconds = 0 } = init;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...BASE_HEADERS,
      ...corsHeaders(corsOrigin),
      'Content-Type': 'application/json; charset=utf-8',
      // private: shared caches must not keep one key's answer for another
      'Cache-Control': cacheSeconds > 0 ? `private, max-age=${cacheSeconds}` : 'no-store'
    }
  });
}

/**
 * An error as { error: { code, message } }. A plain Response, not
 * SvelteKit's error(), which would be reported to Sentry. Errors carry
 * Access-Control-Allow-Origin for every origin, so a website's script can
 * read why it was refused; the body never holds data.
 */
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  origin: string | null = null
): Response {
  const response = apiJson({ error: { code, message } }, { status, corsOrigin: origin });
  if (status === 401) response.headers.set('WWW-Authenticate', 'Bearer realm="alleda"');
  return response;
}

/** The answer to a CORS preflight for a GET endpoint */
export function apiPreflight(request: Request): Response {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: {
      ...BASE_HEADERS,
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

/** Whether a request's Origin may read the answer: none (a server), or one the key lists */
export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  return origin == null || allowed.includes(origin.toLowerCase());
}
