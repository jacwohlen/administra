import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_DATABASE_URL } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';
import { locale } from 'svelte-i18n';
import { clubConfig } from '$lib/clubConfig';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(
    PUBLIC_SUPABASE_DATABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => event.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            event.cookies.set(name, value, { ...options, path: '/' });
          });
        }
      }
    }
  );

  event.locals.safeGetSession = async () => {
    const {
      data: { session }
    } = await event.locals.supabase.auth.getSession();
    if (!session) {
      return { session: null, user: null };
    }
    const {
      data: { user },
      error
    } = await event.locals.supabase.auth.getUser();
    if (error) {
      return { session: null, user: null };
    }
    return { session, user };
  };

  const lang = event.request.headers.get('accept-language')?.split(',')[0];
  if (lang) {
    locale.set(lang);
  }

  // The public trial registration form is German-first (see its +page.ts);
  // everything else follows the request's language.
  const documentLang = event.url.pathname.startsWith('/probetraining')
    ? clubConfig.defaultLocale
    : (lang?.split('-')[0] ?? 'en');

  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', documentLang),
    filterSerializedResponseHeaders(name) {
      return name === 'content-range' || name === 'x-supabase-api-version';
    }
  });
};
