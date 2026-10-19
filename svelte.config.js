import adapter from '@sveltejs/adapter-netlify';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { loadEnv } from 'vite';

// The Supabase project differs per environment (preview branches have their
// own project ref, local development runs on 127.0.0.1), so allow every
// *.supabase.co project plus the one this build is configured for.
const { PUBLIC_SUPABASE_DATABASE_URL } = loadEnv(
  process.env.NODE_ENV ?? 'production',
  process.cwd(),
  'PUBLIC_'
);

function supabaseOrigins() {
  const origins = ['https://*.supabase.co'];
  try {
    const url = new URL(PUBLIC_SUPABASE_DATABASE_URL);
    if (!url.hostname.endsWith('.supabase.co')) origins.push(url.origin);
  } catch {
    // Missing or invalid: the build fails on it elsewhere
  }
  return origins;
}

const supabase = supabaseOrigins();
const supabaseWebSocket = supabase.map((origin) => origin.replace(/^http/, 'ws'));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess()],

  kit: {
    adapter: adapter(),

    // Content Security Policy, see docs/SECURITY_HEADERS.md. Report-Only for
    // now: violations show in the browser console and the function log, but
    // nothing is blocked.
    // Once the dashboard runs without violations, move these directives to
    // `directives` to enforce them. SvelteKit adds a nonce for its own
    // inline scripts (mode 'auto').
    csp: {
      mode: 'auto',
      reportOnly: {
        'default-src': ['self'],
        'script-src': ['self'],
        // Inline style attributes and style elements (Svelte, Skeleton, charts)
        'style-src': ['self', 'unsafe-inline'],
        // Club logo (any URL, set by admins), Google profile pictures,
        // Supabase storage, file previews
        'img-src': ['self', 'data:', 'blob:', 'https:'],
        'font-src': ['self', 'data:'],
        'connect-src': [
          'self',
          ...supabase,
          ...supabaseWebSocket,
          // Sentry, EU region (docs/ERROR_MONITORING.md)
          'https://*.ingest.de.sentry.io',
          'https://*.ingest.sentry.io'
        ],
        // PDF preview of lesson plans (blob: or signed Supabase storage URL)
        'frame-src': ['self', 'blob:', ...supabase],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        // Violations are logged to the Netlify function log
        // (src/routes/api/csp-report). Report-Only requires a report URI.
        'report-uri': ['/api/csp-report']
      }
    }
  }
};

export default config;
