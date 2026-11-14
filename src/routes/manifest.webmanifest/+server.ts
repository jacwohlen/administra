import type { RequestHandler } from '@sveltejs/kit';
import { brandForHost } from '#lib/brand.ts';

/**
 * GET /manifest.webmanifest: the PWA manifest (linked from app.html), with the
 * product's name for this host (#lib/brand.ts), so an app installed from an
 * Azumus address is called Azumus. Same icons for every name.
 */
export const GET: RequestHandler = ({ url }) => {
  const name = brandForHost(url.hostname);
  const manifest = {
    id: '/',
    name,
    short_name: name,
    description: 'Anwesenheit, Mitglieder und Trainings des Vereins',
    lang: 'de',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json',
      // Per host: a shared cache must not hand one host's name to another
      'cache-control': 'public, max-age=3600',
      vary: 'host'
    }
  });
};
