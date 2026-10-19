# Security headers

Every response carries headers that limit what a browser lets other sites
and injected code do with the app.

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`: other sites see the
  origin only, never a path such as `/probetraining/status/<token>`.
- `Permissions-Policy`: camera, microphone, geolocation, payment and USB off
  (not used; the profile photo upload is a file input and needs no
  permission).
- `Content-Security-Policy`: only `frame-ancestors`, who may show a page in
  a frame (enforced).
- `Content-Security-Policy-Report-Only`: the content policy, where scripts,
  styles, images and requests may come from (reported, not enforced yet).

## Who may embed the app

`frame-ancestors` (in `src/lib/server/securityHeaders.ts`) protects against
clickjacking:

- Every page: the app itself and the club's Webling portal
  (`https://jacwohlen.webling.ch`, `WEBLING_PORTAL`). The portal has an
  "Administra" page (see `additional_redirect_urls` in
  `supabase/config.toml`) that may show the app in a frame.
- `/probetraining` and `/probetraining/status/…` additionally: the club
  website (`PUBLIC_CLUB_URL`, with and without `www.`), so the trial form
  can be embedded there.

Neither embedding is confirmed. If the portal page only links to the app,
remove `WEBLING_PORTAL`; to embed another page, extend
`EMBEDDABLE_BY_CLUB_SITE`.

## Content Security Policy

Configured as `kit.csp` in `svelte.config.js`. SvelteKit adds a nonce to its
own inline scripts. Allowed besides the app itself:

- requests: Supabase (`*.supabase.co` and the configured
  `PUBLIC_SUPABASE_DATABASE_URL`, also as WebSocket) and Sentry
  (`*.ingest.de.sentry.io`),
- images: any `https:` URL (the club logo can be any URL), `data:`, `blob:`,
- frames: `blob:` and Supabase (PDF preview of lesson plans),
- styles: inline styles (Svelte, Skeleton and Carbon charts use them).

It is **Report-Only** for now: nothing is blocked, but browsers report each
violation to `/api/csp-report`, which writes one line (`CSP violation:
<directive> blocked <origin> on <path>`) to the Netlify function log. To
enforce it:

1. Use the app for a while (dashboard, statistics, lesson plans with PDF and
   image, member photos, trial form) and check the function log and the
   browser console for `CSP violation` / `[Report Only]`.
2. Fix or allow what shows up, then in `svelte.config.js` rename
   `reportOnly` to `directives` and drop `report-uri` (or keep it).

## Static files

Netlify serves `build/` (JavaScript, CSS, images) from its CDN, not through
SvelteKit. `netlify.toml` gives them the same `X-Content-Type-Options`,
`Referrer-Policy` and `Permissions-Policy`; keep both places in sync.
