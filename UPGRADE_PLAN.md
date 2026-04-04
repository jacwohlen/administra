# SvelteKit Upgrade Plan

Upgrade from **SvelteKit 2.5 + Svelte 4** to **latest SvelteKit 2.x + Svelte 5**, including all related dependency upgrades.

## Current State

| Package | Current Version | Target Version |
|---|---|---|
| svelte | ^4.2.12 | ^5.53.0 |
| @sveltejs/kit | ^2.5.5 | ^2.55.0 |
| @sveltejs/adapter-netlify | ^3.0.2 | ^6.0.4 |
| @sveltejs/vite-plugin-svelte | ^3.0.2 | ^5.x |
| @skeletonlabs/skeleton | ^0.124.2 | ^3.x (Skeleton v3) |
| @supabase/auth-helpers-sveltekit | ^0.8.7 | Remove (use @supabase/ssr) |
| svelte-preprocess | ^5.1.3 | Remove (no longer needed) |
| tailwindcss | ^3.4.3 | ^4.x |
| vite | ^5.2.7 | ^6.x |
| vitest | ^1.4.0 | ^3.x |
| prettier | ^2.8.8 | ^3.x |
| eslint | ^8.57.0 | ^9.x |

## Scope Summary

- **31 .svelte files** with `export let` props (51 occurrences) -> `$props()`
- **20 .svelte files** with `on:` event directives (67 occurrences) -> event attributes
- **2 .svelte files** with `<slot>` (3 occurrences) -> `{@render}` snippets
- **1 file** using `$app/stores` -> `$app/state`
- **0** reactive declarations (`$:`) found
- **13+ files** importing Skeleton UI components -> migrate to Skeleton v3 APIs
- **1 store** usage in tests (minimal store migration)

## Security Note

SvelteKit versions 2.44.0-2.49.4 had five CVEs disclosed in January 2026. Upgrading is important for security.

---

## Phase 1: Foundation (Low Risk)

Update tooling and config that doesn't affect runtime behavior.

### Step 1.1: Upgrade Prettier and ESLint

- Upgrade `prettier` from ^2.8 to ^3.x
- Upgrade `prettier-plugin-svelte` from ^2.10 to ^3.x
- Remove deprecated `--plugin-search-dir .` flag from all scripts and lint-staged config
- Upgrade `eslint` from ^8 to ^9.x (flat config format)
- Upgrade `eslint-plugin-svelte` to latest
- Replace `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` with `typescript-eslint` v8+
- Remove `eslint-config-prettier` (integrated differently in ESLint 9)
- Convert `.eslintrc` to `eslint.config.js` (flat config)
- Run `npm run format` and `npm run lint` to verify

### Step 1.2: Upgrade Vite and Vitest

- Upgrade `vite` from ^5 to ^6.x
- Upgrade `vitest` from ^1 to ^3.x
- Update `vite.config.js` if any breaking API changes
- Update test setup if needed (`@testing-library/svelte` ^5 should be compatible)
- Run `npm run test:unit` to verify

### Step 1.3: Upgrade TypeScript and svelte-check

- Upgrade `typescript` to ^5.7+
- Upgrade `svelte-check` from ^3 to ^4.x (for Svelte 5 support)
- Run `npm run check` to verify

---

## Phase 2: Supabase Auth Migration (Medium Risk)

Migrate from deprecated `@supabase/auth-helpers-sveltekit` to `@supabase/ssr` before touching Svelte/SvelteKit versions.

### Step 2.1: Install @supabase/ssr

- `npm install @supabase/ssr`
- `npm uninstall @supabase/auth-helpers-sveltekit`
- Upgrade `@supabase/supabase-js` to latest ^2.x

### Step 2.2: Update hooks.server.ts

Replace auth-helpers middleware with `@supabase/ssr` server client:

- Replace `createSupabaseServerClient` with `createServerClient` from `@supabase/ssr`
- Update cookie handling (ssr package requires explicit cookie get/set/remove handlers)
- Update `event.locals` to expose `supabase` and `safeGetSession()`

### Step 2.3: Update src/app.d.ts

- Update `App.Locals` interface to match new `@supabase/ssr` types
- Replace `TypedSupabaseClient` with proper Supabase client type

### Step 2.4: Update layout files

- `src/routes/+layout.server.ts` - Use new `safeGetSession()` pattern
- `src/routes/+layout.ts` - Replace `getSupabase()` with `createBrowserClient` from `@supabase/ssr`
- `src/routes/+layout.svelte` - Update auth state handling
- `src/routes/dashboard/+layout.ts` - Update session check

### Step 2.5: Update all Supabase client usage

- Search for any direct `supabase` client imports and update
- Verify auth flow (login, logout, session refresh) works end-to-end

---

## Phase 3: Svelte 5 + SvelteKit Core Upgrade (High Risk, Largest Phase)

### Step 3.1: Upgrade core packages

```bash
npm install svelte@^5 @sveltejs/kit@latest @sveltejs/adapter-netlify@latest
npm install @sveltejs/vite-plugin-svelte@latest
npm uninstall svelte-preprocess
```

### Step 3.2: Update svelte.config.js

- Remove `svelte-preprocess` import and usage
- Keep `vitePreprocess()` (now from `@sveltejs/vite-plugin-svelte`)
- Ensure adapter-netlify config is still correct

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

The migration tool doesn't catch everything. Review and fix:

- **`$app/stores`** usage in `dashboard/+layout.svelte` -> replace with `$app/state`
  - `$page` store -> `page` from `$app/state` (no `$` prefix needed)
- **Component event forwarding** - any `on:click` forwarding needs manual conversion
- **`$$restProps`** -> `...restProps` from `$props()`
- **Two-way binding** - `bind:` still works but check for edge cases
- **Transition directives** - verify `transition:`, `in:`, `out:` still work correctly
- **Action directives** - `use:` still works in Svelte 5

### Step 3.5: Type checking and build verification

- Run `npm run check` - fix all type errors
- Run `npm run build` - fix all build errors
- Run `npm run test:unit` - fix all test failures

---

## Phase 4: Tailwind CSS 4 Migration (Medium Risk)

### Step 4.1: Upgrade Tailwind

```bash
npm install tailwindcss@^4 @tailwindcss/vite
npm uninstall autoprefixer postcss-load-config @tailwindcss/forms
```

### Step 4.2: Convert config to CSS-based

- Delete `tailwind.config.cjs` and `postcss.config.cjs`
- Move theme configuration into `src/app.css` using `@theme` directive
- Replace `@tailwind base/components/utilities` with `@import "tailwindcss"`
- Migrate custom theme colors from `tailwind.config.cjs` to CSS custom properties

### Step 4.3: Update Vite config

- Add `@tailwindcss/vite` plugin to `vite.config.js`
- Remove PostCSS-based Tailwind setup

### Step 4.4: Verify styles

- Check all pages for visual regressions
- Verify dark mode still works
- Check `@tailwindcss/forms` replacement (may need `@plugin` syntax in v4)

---

## Phase 5: Skeleton UI v3 Migration (Highest Risk, Most Effort)

This is the most labor-intensive phase. Skeleton v3 is a complete rewrite.

### Step 5.1: Install Skeleton v3

```bash
npm uninstall @skeletonlabs/skeleton
npm install @skeletonlabs/skeleton@^3 @skeletonlabs/skeleton-svelte
```

Note: Skeleton v3 separates core (design tokens/theme) from framework-specific components.

### Step 5.2: Migrate theme

- Replace `src/theme.postcss` with Skeleton v3 theme configuration
- Skeleton v3 themes use CSS custom properties and integrate with Tailwind v4
- Recreate the red primary / light gray surface color scheme using v3 theme API

### Step 5.3: Migrate components (13+ files)

Each component has a new API in v3. Key migrations:

| Old (v0.x) | New (v3) | Files Affected |
|---|---|---|
| `AppShell` | Layout components | dashboard/+layout.svelte |
| `TabGroup` / `Tab` | `Tabs` component (Zag.js) | dashboard/+layout.svelte |
| `Modal` / `modalStore` | Dialog component (Zag.js) | members/+page.svelte, MemberForm.svelte |
| `Toast` / `toastStore` | Toast component (Zag.js) | +layout.svelte, multiple files |
| `Avatar` | Avatar component | +layout.svelte, member pages |
| `menu` action | Menu/Popover component | +layout.svelte |

### Step 5.4: Update Skeleton utility classes

- Skeleton v3 may use different utility class names
- Search for Skeleton-specific CSS classes (`.btn`, `.card`, `.table-*`, etc.)
- Update to v3 equivalents

### Step 5.5: Visual regression testing

- Manually test all major pages
- Verify responsive layout still works
- Check dark mode theming

---

## Phase 6: Remaining Dependencies (Low Risk)

### Step 6.1: Svelte ecosystem packages

- `svelte-i18n` - Test compatibility with Svelte 5. If peer dependency warnings, use `--force`. If broken, evaluate `paraglide-js` as alternative
- `svelte-fa` - Check for Svelte 5 compatible version
- `svelte-heatmap` - Check for Svelte 5 compatible version
- `@carbon/charts-svelte` - Check for Svelte 5 compatible version

### Step 6.2: Other upgrades

- `@playwright/test` - Upgrade to latest
- `dayjs` - Already latest-ish, verify still works
- `d3` - Already latest-ish, verify still works
- `jsdom` - Upgrade to latest
- `tslib` - May no longer be needed with Svelte 5

### Step 6.3: Clean up

- Remove `postcss-load-config` if no longer needed
- Remove any unused dependencies
- Update `package.json` scripts (remove `--plugin-search-dir .`)
- Verify `lint-staged` config is current

---

## Phase 7: Final Verification

### Step 7.1: Full test suite

```bash
npm run check      # TypeScript
npm run lint       # Prettier + ESLint
npm run test:unit  # Vitest
npm run build      # Production build
```

### Step 7.2: Manual smoke testing

- Login flow (Google OAuth)
- Dashboard navigation (tabs)
- Members list + detail page
- Training attendance tracking
- Events CRUD
- Stats/charts rendering
- i18n language switching (de/en)
- Toast notifications
- Modal dialogs

### Step 7.3: Deploy preview

- Deploy to Netlify preview branch
- Verify SSR and client-side navigation
- Verify Supabase connection in deployed environment

---

## Risk Mitigation

1. **Create a dedicated upgrade branch** - All work on a feature branch
2. **Phase-by-phase commits** - Commit after each phase so rollback is easy
3. **Skeleton v3 is the biggest risk** - If too complex, consider keeping Skeleton v2 temporarily (it has Svelte 5 compatibility mode) and upgrading to v3 later
4. **svelte-i18n fallback** - If incompatible, `paraglide-js` by Inlang is the recommended SvelteKit i18n solution
5. **Run `npm run build` after each phase** - Catch issues early

## Estimated Effort by Phase

| Phase | Description | Relative Effort |
|---|---|---|
| Phase 1 | Tooling (Prettier, ESLint, Vite) | Small |
| Phase 2 | Supabase auth migration | Medium |
| Phase 3 | Svelte 5 + SvelteKit core | Large |
| Phase 4 | Tailwind CSS 4 | Medium |
| Phase 5 | Skeleton UI v3 | Very Large |
| Phase 6 | Remaining dependencies | Small |
| Phase 7 | Verification | Medium |

## Recommended Approach

Execute phases **in order**. Each phase should result in a working, buildable application before moving to the next. Phase 5 (Skeleton) can optionally be deferred if the v2-to-v3 migration proves too disruptive -- Skeleton v2 has a Svelte 5 compatibility layer.
