import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_DATABASE_URL } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { clubConfig } from '$lib/clubConfig';
import { sentryOptions } from '$lib/sentry';
import { addSecurityHeaders } from '$lib/server/securityHeaders';
import { parseUserLocale, USER_LOCALE_COOKIE } from '$lib/userLocale';
import { setAppLocale } from '$lib/i18n/appLocale';

// Error reports from the server, see docs/ERROR_MONITORING.md.
Sentry.init(
  sentryOptions(env.PUBLIC_SENTRY_DSN, __NETLIFY_CONTEXT__, env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
);

const setup: Handle = async ({ event, resolve }) => {
  // Created on first use: as soon as it exists, the Supabase client checks the
  // session cookie in the background and refreshes an expired token. On a
  // request that never awaits the session, that refresh finishes after the
  // response is sent, and the cookie write throws as an unhandled rejection.
  // That crashes the Netlify function and a later request gets a 502.
  let supabase: SupabaseClient | undefined;
  let responded = false;
  Object.defineProperty(event.locals, 'supabase', {
    get: () =>
      (supabase ??= createServerClient(PUBLIC_SUPABASE_DATABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
          getAll: () => event.cookies.getAll(),
          setAll: (cookiesToSet) => {
            // A refresh that lands after the response can no longer set cookies
            if (responded) return;
            cookiesToSet.forEach(({ name, value, options }) => {
              event.cookies.set(name, value, { ...options, path: '/' });
            });
          }
        }
      }))
  });

  // Checks the session cookie's token: with asymmetric JWT signing keys
  // getClaims() verifies it locally against the cached public key (no request
  // to Supabase Auth); with the legacy shared secret it asks the Auth server
  // like getUser() (docs/PERFORMANCE.md).
  event.locals.safeGetSession = async () => {
    const {
      data: { session }
    } = await event.locals.supabase.auth.getSession();
    if (!session) {
      return { session: null, user: null };
    }
    const { data, error } = await event.locals.supabase.auth.getClaims();
    const userId = data?.claims.sub;
    if (error || !userId || userId !== session.user.id) {
      return { session: null, user: null };
    }
    // The e-mail from the same verified token: plan mails use it as Reply-To
    const email = typeof data.claims.email === 'string' ? data.claims.email : undefined;
    return { session, user: { id: userId, email } };
  };

  // A language picked in the profile menu wins over the browser's.
  const lang =
    parseUserLocale(event.cookies.get(USER_LOCALE_COOKIE)) ??
    event.request.headers.get('accept-language')?.split(',')[0];
  if (lang) {
    setAppLocale(lang);
  }

  // The public trial registration form is German-first (see its +page.ts);
  // everything else follows the request's language.
  const documentLang = event.url.pathname.startsWith('/probetraining')
    ? clubConfig.defaultLocale
    : (lang?.split('-')[0] ?? 'en');

  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', documentLang),
    filterSerializedResponseHeaders(name) {
      return name === 'content-range' || name === 'x-supabase-api-version';
    }
  });
  responded = true;
  return response;
};

// X-Content-Type-Options, Referrer-Policy, Permissions-Policy and who may
// frame the page, see src/lib/server/securityHeaders.ts.
const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  addSecurityHeaders(response.headers);
  return response;
};

export const handle = sequence(
  // No inline fetch proxy script: SvelteKit >= 2.16 does not need it, and it
  // would violate the Content Security Policy (svelte.config.js).
  Sentry.sentryHandle({ injectFetchProxyScript: false }),
  securityHeaders,
  setup
);

export const handleError = Sentry.handleErrorWithSentry(({ message }) => ({
  message,
  errorId: Sentry.lastEventId()
}));
