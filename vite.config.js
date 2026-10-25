import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Git branch baked in at build time for the DEV environment banner.
  // Netlify sets HEAD (PR head branch) on deploy previews and BRANCH on
  // branch/production deploys; local builds fall back to 'local'.
  define: {
    __GIT_BRANCH__: JSON.stringify(process.env.HEAD || process.env.BRANCH || 'local'),
    // Netlify's deploy context (production, branch-deploy, deploy-preview),
    // used as the Sentry environment (src/lib/sentry.ts).
    __NETLIFY_CONTEXT__: JSON.stringify(process.env.CONTEXT ?? '')
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
    sveltekit(),
    svelteTesting()
  ],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.test.js'],
    environment: 'jsdom',
    setupFiles: ['./src/lib/test/setup.ts']
  }
});
