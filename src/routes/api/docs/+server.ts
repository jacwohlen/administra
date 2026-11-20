import type { RequestHandler } from '@sveltejs/kit';
import { brandForHost, withBrand } from '#lib/brand.ts';
import { apiDocsPage, apiDocsPolicy } from '#lib/server/apiDocs.ts';

/** GET /api/docs: the API reference, see src/lib/server/apiDocs.ts */
export const GET: RequestHandler = ({ url }) => {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return new Response(withBrand(apiDocsPage(nonce), brandForHost(url.hostname)), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': apiDocsPolicy(nonce),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex'
    }
  });
};
