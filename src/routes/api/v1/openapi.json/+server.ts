import type { RequestHandler } from '@sveltejs/kit';
import { openApiDocument } from '#lib/openApi.ts';

/**
 * GET /api/v1/openapi.json: the OpenAPI description of the API
 * (src/lib/openApi.ts), for /api/docs and for tools such as Postman or
 * Bruno. Public: it describes the endpoints, holds no data.
 */
export const GET: RequestHandler = ({ url }) =>
  new Response(JSON.stringify(openApiDocument(url.origin), null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex'
    }
  });
