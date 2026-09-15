import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Git branch baked in at build time for the DEV environment banner.
  // Netlify sets HEAD (PR head branch) on deploy previews and BRANCH on
  // branch/production deploys; local builds fall back to 'local'.
  define: {
    __GIT_BRANCH__: JSON.stringify(process.env.HEAD || process.env.BRANCH || 'local')
  },
  plugins: [tailwindcss(), sveltekit(), svelteTesting()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
    setupFiles: ['./src/lib/test/setup.ts']
  }
});
