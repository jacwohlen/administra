import adapter from '@sveltejs/adapter-netlify';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/** @typedef {NonNullable<NonNullable<NonNullable<import('@sveltejs/kit/vite').Config['csp']>['reportOnly']>['connect-src']>} CspSources */

// The Supabase project differs per environment (preview branches have their
// own project ref, local development runs on 127.0.0.1), so allow every
// *.supabase.co project plus the one this build is configured for.
/**
 * @param {string} mode
 * @returns {CspSources}
 */
function supabaseOrigins(mode) {
  const { PUBLIC_SUPABASE_DATABASE_URL } = loadEnv(mode, process.cwd(), 'PUBLIC_');
  /** @type {CspSources} */
  const origins = ['https://*.supabase.co'];
  try {
    const url = new URL(PUBLIC_SUPABASE_DATABASE_URL);
    if (!url.hostname.endsWith('.supabase.co')) origins.push(/** @type {any} */ (url.origin));
  } catch {
    // Missing or invalid: the build fails on it elsewhere
  }
  return origins;
}

export default defineConfig(({ mode }) => {
  const supabase = supabaseOrigins(mode);
  const supabaseWebSocket = /** @type {CspSources} */ (
    supabase.map((origin) => origin.replace(/^http/, 'ws'))
  );

  return {
    // Git branch baked in at build time for the DEV environment banner.
    // Netlify sets HEAD (PR head branch) on deploy previews and BRANCH on
    // branch/production deploys; local builds fall back to 'local'.
    define: {
      __GIT_BRANCH__: JSON.stringify(process.env.HEAD || process.env.BRANCH || 'local'),
      // Netlify's deploy context (production, branch-deploy, deploy-preview),
      // used as the Sentry environment (src/lib/sentry.ts).
      __NETLIFY_CONTEXT__: JSON.stringify(process.env.CONTEXT ?? ''),
      // Leaves the Sentry SDK's debug logging out of the bundles (what the
      // plugin's bundleSizeOptimizations.excludeDebugStatements does, without
      // switching on its source map and release handling for every build)
      __SENTRY_DEBUG__: false
    },
    plugins: [
      // Uploads source maps to Sentry so stack traces show our code, then
      // deletes them from the build. Only when SENTRY_AUTH_TOKEN is set (Netlify).
      sentrySvelteKit({
        adapter: 'other',
        autoInstrument: false,
        autoUploadSourceMaps: Boolean(process.env.SENTRY_AUTH_TOKEN),
        telemetry: false,
        sourcemaps: {
          filesToDeleteAfterUpload: [
            './build/**/*.map',
            './.svelte-kit/**/*.map',
            './.netlify/**/*.map'
          ]
        }
      }),
      tailwindcss(),
      // SvelteKit configuration (SvelteKit 3 no longer reads svelte.config.js)
      sveltekit({
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
      }),
      svelteTesting()
    ],
    test: {
      include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.test.js', 'marketing/**/*.test.js'],
      environment: 'jsdom',
      setupFiles: ['./src/lib/test/setup.ts']
    }
  };
});
