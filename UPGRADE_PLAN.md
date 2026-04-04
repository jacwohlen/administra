# SvelteKit Upgrade Plan

Upgrade from **SvelteKit 2.5 + Svelte 4** to **latest SvelteKit 2.x + Svelte 5**, including all related dependency upgrades.

## Current State

| Package                          | Current Version | Target Version             |
| -------------------------------- | --------------- | -------------------------- |
| svelte                           | ^4.2.12         | ^5.x                       |
| @sveltejs/kit                    | ^2.5.5          | ^2.55+                     |
| @sveltejs/adapter-netlify        | ^3.0.2          | ^6.x                       |
| @sveltejs/vite-plugin-svelte     | ^3.0.2          | ^5.x                       |
| @skeletonlabs/skeleton           | ^0.124.2        | ^2.x (see Phase 5)         |
| @supabase/auth-helpers-sveltekit | ^0.8.7          | Remove (use @supabase/ssr) |
| svelte-preprocess                | ^5.1.3          | Remove (no longer needed)  |
| tailwindcss                      | ^3.4.3          | ^4.x                       |
| vite                             | ^5.2.7          | ^6.x                       |
| vitest                           | ^1.4.0          | ^3.x                       |
| prettier                         | ^2.8.8          | ^3.x                       |
| eslint                           | ^8.57.0         | ^9.x                       |

## Scope Summary (Revised)

- **31 .svelte files** with `export let` props (51 occurrences) -> `$props()`
- **20 .svelte files** with `on:` event directives (67 occurrences) -> event attributes
- **~30 reactive declarations** (`$:`) across 14 files -> `$derived` / `$effect`
- **3 files** using `createEventDispatcher` -> callback props
- **2 files** with `<slot>` (3 occurrences) -> `{@render}` snippets
- **2 files** with `<svelte:fragment slot=...>` -> snippet props (Skeleton-dependent)
- **1 file** using `$app/stores` (`$page`) -> `$app/state` (`page`)
- **13+ files** importing Skeleton UI components
- **0** `$$restProps` / `$$props` usages

## Security Note

SvelteKit versions 2.44.0-2.49.4 had five CVEs disclosed in January 2026. Upgrading is important for security.

---

## Prerequisites

Before starting any phase:

1. **Verify Node.js version** - Svelte 5 + Vite 6 require Node 18+. Check `netlify.toml` and add `NODE_VERSION` environment variable if needed.
2. **Clean install strategy** - After each phase's package changes, run `rm -rf node_modules package-lock.json && npm install` to avoid phantom dependency issues.
3. **All work on a feature branch** - Commit after each phase so rollback is easy.

---

## Phase 1: Tooling Foundation (Low Risk)

Update tooling and config that doesn't affect runtime behavior.

### Step 1.1: Upgrade Prettier and ESLint

- Upgrade `prettier` from ^2.8 to ^3.x
- Upgrade `prettier-plugin-svelte` from ^2.10 to ^3.x
- Remove deprecated `--plugin-search-dir .` flag from:
  - `package.json` scripts (`lint`, `format`)
  - `package.json` lint-staged config
- Upgrade `eslint` from ^8 to ^9.x (flat config format)
- Upgrade `eslint-plugin-svelte` to latest
- Replace `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` with `typescript-eslint` v8+
- Remove `eslint-config-prettier` (integrated differently in ESLint 9)
- Delete `.eslintrc.cjs`, create `eslint.config.js` (flat config)
- Run `npm run format` and `npm run lint` to verify

### Step 1.2: Upgrade Vite and Vitest

- Upgrade `vite` from ^5 to ^6.x
- Upgrade `vitest` from ^1 to ^3.x
- Convert `vite.config.js` to use `defineConfig` (recommended for Vite 6)
- Update test setup if needed (`@testing-library/svelte` ^5 should be compatible)
- Run `npm run test:unit` to verify

### Step 1.3: Upgrade TypeScript and svelte-check

- Upgrade `typescript` to ^5.7+
- Upgrade `svelte-check` from ^3 to ^4.x (for Svelte 5 support)
- Run `npm run check` to verify

**Verification gate:** `npm run lint && npm run check && npm run test:unit && npm run build`

---

## Phase 2: Tailwind CSS 4 Migration (Medium Risk)

Do this **before** Svelte 5 since it's independent and Skeleton v2 with Tailwind 4 support will be needed later.

### Step 2.1: Upgrade Tailwind

```bash
npm install tailwindcss@^4 @tailwindcss/vite
npm uninstall autoprefixer postcss-load-config @tailwindcss/forms
```

### Step 2.2: Convert config to CSS-based

- Delete `tailwind.config.cjs` and `postcss.config.cjs`
- Move theme configuration into `src/app.css` using `@theme` directive
- Replace `@tailwind base/components/utilities` with `@import "tailwindcss"`
- Migrate custom colors from `tailwind.config.cjs` to CSS custom properties
- Preserve the Skeleton UI content paths (will need Skeleton plugin equivalent)

### Step 2.3: Update Vite config

- Add `@tailwindcss/vite` plugin to `vite.config.js`
- Remove PostCSS-based Tailwind setup

### Step 2.4: Verify styles

- Check all pages for visual regressions
- Verify dark mode still works
- Verify `@tailwindcss/forms` replacement (may need `@plugin` syntax in v4)

**Verification gate:** `npm run build` + visual check of all pages

---

## Phase 3: Svelte 5 + SvelteKit Core Upgrade (High Risk, Largest Phase)

### Step 3.1: Upgrade core packages

```bash
npm install svelte@^5 @sveltejs/kit@latest @sveltejs/adapter-netlify@latest
npm install @sveltejs/vite-plugin-svelte@latest
npm uninstall svelte-preprocess
```

### Step 3.2: Update svelte.config.js

Current config uses both `vitePreprocess()` and `svelte-preprocess`:

```js
preprocess: [
  vitePreprocess(),
  preprocess({ postcss: true }) // remove this
];
```

- Remove `svelte-preprocess` import and the `preprocess({ postcss: true })` entry
- Keep `vitePreprocess()` (now from `@sveltejs/vite-plugin-svelte`) - it handles PostCSS
- Verify adapter-netlify config still works

### Step 3.3: Run automated migration tool

```bash
npx sv migrate svelte-5
```

This will automatically convert:

- `export let` -> `$props()`
- `on:click` -> `onclick` (and other event directives)
- `<slot>` -> `{@render children()}`
- `createEventDispatcher` -> callback props
- Various other Svelte 5 syntax changes

### Step 3.4: Manual migration fixes (post-tool)

The migration tool doesn't catch everything. Known items to fix manually:

**Reactive declarations (`$:`) -> `$derived` / `$effect` (30 occurrences in 14 files):**

- Simple derivations (`$: x = expr`) -> `let x = $derived(expr)`
- Side effects (`$: if (cond) { ... }`) -> `$effect(() => { ... })`
- Files with most `$:` usage:
  - `trainings/[trainingId]/[date]/ParticipantFrequency.svelte` (8 occurrences)
  - `trainings/[trainingId]/[date]/+page.svelte` (6 occurrences)
  - `events/[eventId]/+page.svelte` (4 occurrences)
  - `trainings/[trainingId]/[date]/LessonPlan.svelte` (1 occurrence, but complex)

**`$app/stores` -> `$app/state` (1 file):**

- `dashboard/+layout.svelte`: `import { page } from '$app/stores'` -> `import { page } from '$app/state'`
- All `$page.xxx` references -> `page.xxx` (no `$` prefix, it's a reactive object now)

**`createEventDispatcher` -> callback props (3 files):**

- `AddParticipantInputBox.svelte` - `dispatch('select', member)` -> call an `onselect` prop
- `ParticipantCard.svelte` - `dispatch(...)` -> callback props
- `AddEventParticipant.svelte` - `dispatch(...)` -> callback props
- Also update parent components that listen via `on:select={handler}` -> `onselect={handler}`

**`<svelte:fragment slot="...">` (2 files):**

- `dashboard/+layout.svelte`: `<svelte:fragment slot="header">` - This is Skeleton UI's slot API; will be addressed in Phase 5
- `LessonPlan.svelte`: `<svelte:fragment slot="panel">` - Same

**`$locale` store usage (1 file):**

- `+layout.svelte` line 10: `$: if ($locale)` uses svelte-i18n's store - verify this still works with Svelte 5's backward-compatible store support

### Step 3.5: Update src/app.d.ts

Svelte 5 changed the `App` namespace pattern. Update:

```ts
declare global {
  namespace App {  // remove 'declare' keyword (was double-declared)
    ...
  }
}
```

### Step 3.6: Type checking and build verification

- Run `npm run check` - fix all type errors
- Run `npm run build` - fix all build errors
- Run `npm run test:unit` - fix all test failures

**Verification gate:** `npm run check && npm run lint && npm run test:unit && npm run build`

---

## Phase 4: Supabase Auth Migration (Medium Risk)

Migrate from deprecated `@supabase/auth-helpers-sveltekit` to `@supabase/ssr`. Done **after** Svelte 5 so we're only changing one major thing at a time. The auth-helpers package still works with Svelte 5.

### Step 4.1: Install @supabase/ssr

```bash
npm install @supabase/ssr
npm uninstall @supabase/auth-helpers-sveltekit
```

- Also upgrade `@supabase/supabase-js` to latest ^2.x

### Step 4.2: Replace src/lib/supabase.ts

Current file creates a client via `createClient` from auth-helpers. Replace with:

- `createBrowserClient` from `@supabase/ssr` for client-side usage
- `createServerClient` from `@supabase/ssr` for server-side usage (in hooks)

### Step 4.3: Update hooks.server.ts

Current code:

```ts
import { getSupabase } from '@supabase/auth-helpers-sveltekit';
```

Replace with `createServerClient` from `@supabase/ssr` with explicit cookie get/set/remove handlers via `event.cookies`.

### Step 4.4: Update src/app.d.ts

- Replace `TypedSupabaseClient` import (from auth-helpers internals) with `SupabaseClient` from `@supabase/supabase-js`
- Update `App.Locals` interface: `sb` -> `supabase`, add `safeGetSession()`

### Step 4.5: Update layout files

- `src/routes/+layout.ts` - Replace `getSupabase(event)` with browser client creation
- `src/routes/+layout.server.ts` - Use `event.locals.safeGetSession()`
- `src/routes/+layout.svelte` - Update `supabaseClient` import for auth state listener
- `src/routes/dashboard/+layout.svelte` - Update `supabaseClient.auth.signOut()` call

### Step 4.6: Update all Supabase client usage across the app

- Grep for `supabaseClient` imports and update references
- Verify auth flow end-to-end: login, session, logout

**Verification gate:** Full auth flow test + `npm run build`

---

## Phase 5: Skeleton UI Migration (Highest Risk)

### Recommended: Upgrade to Skeleton v2 (not v3)

The project uses Skeleton **v0.124** (pre-v1). Skeleton v3 is a complete Zag.js-based rewrite with entirely different APIs. Going v0 -> v3 in one step is extremely risky.

**Recommended approach:**

1. Upgrade to **Skeleton v2** first - it supports Svelte 5 compatibility mode and has a clearer migration path from v0/v1
2. Defer Skeleton v3 to a separate future effort

If Skeleton v2 doesn't meet needs, v3 can be considered but should be its own project.

### Step 5.1: Install Skeleton v2

```bash
npm install @skeletonlabs/skeleton@^2 @skeletonlabs/tw-plugin@^0.4
```

### Step 5.2: Migrate theme

- Replace `src/theme.postcss` with Skeleton v2 theme format
- Update CSS imports in `+layout.svelte` (Skeleton v2 changed import paths from `styles/all.css`)
- Recreate the red primary / light gray surface color scheme

### Step 5.3: Migrate components (13+ files)

Skeleton v0 -> v2 component changes (less drastic than v0 -> v3):

| Component              | Key Changes                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `AppShell`             | Props/slots may have changed                                      |
| `TabGroup` / `Tab`     | API updates                                                       |
| `Modal` / `modalStore` | Modal system changes                                              |
| `Toast` / `toastStore` | Toast system changes                                              |
| `Avatar`               | Prop changes (e.g., `border`, `cursor` strings -> separate props) |
| `menu` action          | May be replaced with popup/popover                                |

Key files to update:

- `src/routes/+layout.svelte` - CSS imports, Toast
- `src/routes/dashboard/+layout.svelte` - AppShell, TabGroup, Tab, Avatar, menu, Modal, Toast (heaviest Skeleton usage)
- `src/routes/dashboard/members/+page.svelte` - Modal usage
- `src/routes/dashboard/trainings/[trainingId]/[date]/LessonPlan.svelte` - TabGroup with panel slot
- Plus ~9 more files with lighter Skeleton usage

### Step 5.4: Update Skeleton utility classes

- Search for Skeleton-specific CSS classes (`.btn`, `.card`, `.table-*`, `.list-nav`, token classes like `border-surface-300-600-token`)
- Update to v2 equivalents

### Step 5.5: Visual regression testing

- Test all major pages for layout/styling
- Verify responsive behavior
- Verify dark mode theming

**Verification gate:** `npm run build` + full visual check

---

## Phase 6: Remaining Dependencies (Low Risk)

### Step 6.1: Svelte ecosystem packages

| Package                 | Action                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `svelte-i18n`           | Test with Svelte 5. If peer dep warnings, use `--force`. If broken, evaluate `paraglide-js` |
| `svelte-fa`             | Check for Svelte 5 compatible version                                                       |
| `svelte-heatmap`        | Check for Svelte 5 compatible version                                                       |
| `@carbon/charts-svelte` | Check for Svelte 5 compatible version (this may be a blocker)                               |

### Step 6.2: Other upgrades

- `@playwright/test` - Upgrade to latest
- `dayjs` - Verify still works (should be fine)
- `d3` - Verify still works (should be fine)
- `jsdom` - Upgrade to latest
- `tslib` - May no longer be needed with Svelte 5 (test removal)
- `image-resize-compress` - Keep as-is

### Step 6.3: Clean up

- Remove `postcss-load-config` if no longer needed after Tailwind 4
- Remove any unused dependencies
- Update `package.json` scripts
- Verify `lint-staged` config works with new Prettier/ESLint

**Verification gate:** `npm run check && npm run lint && npm run test:unit && npm run build`

---

## Phase 7: Final Verification & Deployment

### Step 7.1: Full test suite

```bash
npm run check      # TypeScript
npm run lint       # Prettier + ESLint
npm run test:unit  # Vitest
npm run build      # Production build
```

### Step 7.2: Manual smoke testing

- [ ] Login flow (Google OAuth)
- [ ] Dashboard navigation (tabs)
- [ ] Members list + detail page
- [ ] Training attendance tracking (adding/removing participants)
- [ ] Events CRUD
- [ ] Stats/charts rendering
- [ ] i18n language switching (de/en)
- [ ] Toast notifications
- [ ] Modal dialogs
- [ ] Profile menu (avatar dropdown)

### Step 7.3: Deploy preview

- Update `netlify.toml` if needed (add `NODE_VERSION = "20"` under `[build.environment]`)
- Deploy to Netlify preview branch
- Verify SSR and client-side navigation
- Verify Supabase connection in deployed environment
- Verify Google OAuth redirect works

---

## Risk Mitigation

1. **Phase-by-phase commits** - Each phase produces a working build before moving on
2. **Clean installs** - `rm -rf node_modules package-lock.json && npm install` between phases
3. **Skeleton v2 instead of v3** - Dramatically reduces migration scope; v3 can be a future project
4. **Supabase auth after Svelte 5** - Avoid changing two major things simultaneously
5. **svelte-i18n fallback** - If incompatible, `paraglide-js` by Inlang is the recommended alternative
6. **`@carbon/charts-svelte` risk** - If no Svelte 5 version exists, may need to replace with direct d3 usage or `layerchart`

## Estimated Effort by Phase

| Phase   | Description                      | Relative Effort |
| ------- | -------------------------------- | --------------- |
| Phase 1 | Tooling (Prettier, ESLint, Vite) | Small           |
| Phase 2 | Tailwind CSS 4                   | Medium          |
| Phase 3 | Svelte 5 + SvelteKit core        | Large           |
| Phase 4 | Supabase auth migration          | Medium          |
| Phase 5 | Skeleton UI v0 -> v2             | Large           |
| Phase 6 | Remaining dependencies           | Small           |
| Phase 7 | Verification & deployment        | Medium          |
