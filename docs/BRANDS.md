# Two Names: Alleda and Azumus

The app has two names, by the address it is opened at: **Azumus** on a host
whose name contains `azumus` (e.g. `azumus.ch`, `app.azumus.ch`), **Alleda**
everywhere else (`alleda.ch`, `demo.alleda.ch`, `admin.jacwohlen.ch`, club
instances, `localhost`). The logo is the same for both. The rule lives in
`src/lib/brand.ts` (`BRANDS`): another name is one more line there.

## Where the name changes

- **Texts:** the locale files say "Alleda". In the browser,
  `src/lib/i18n/index.ts` loads them through `brandMessages()` with the
  host's name; on the server, whose messages are shared by every request,
  `hooks.server.ts` puts the name into the rendered page
  (`transformPageChunk` + `withBrand()`). `withBrand()` replaces "Alleda" as a
  word only: host names (`alleda.ch`), the API key prefix `alleda_` and
  names such as `alleda-theme` stay.
- **Logo alt text** (`src/routes/LogoImage.svelte`)
- **PWA manifest:** `/manifest.webmanifest` is a route
  (`src/routes/manifest.webmanifest/+server.ts`), not a static file, so an
  app installed from an Azumus address is called Azumus.
- **API docs:** `/api/docs` and `/api/v1/openapi.json`

## Not by host

These have one name per Supabase project or deploy, set outside the code:

- the sign-in code e-mail (Supabase Auth template and subject)
- the Google OAuth consent screen
- the sender name of trial e-mails (`SMTP_SENDER_NAME` per club instance)
- the calendar feeds' `PRODID` and the assistant's prompt (not shown to
  people)
- the marketing site alleda.ch (static HTML in `marketing/`)

## A new Azumus domain

1. Add it as a domain alias of the Netlify site that serves the app.
2. Add `https://<domain>/**` to the Supabase project's Auth redirect URLs
   (sign-in comes back to the address it started from).
3. Google sign-in: the redirect goes through Supabase, so nothing to add
   there unless the consent screen should show the new name.
