# adsumus.ch — marketing site

The public website for Adsumus (Latin for "we are here", formerly
Administra; the repository keeps the old name): what it does, the demo link, and a contact form for
interested clubs. Plain static HTML and CSS in
[`public/`](public/), no build step, no cookies, no tracking, one small script of
our own (the light/dark switch, `public/assets/theme.js`),
no third-party fonts or scripts.

| Page                   | File                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| Home with contact form | [`public/index.html`](public/index.html)                         |
| Thanks after the form  | [`public/danke/index.html`](public/danke/index.html)             |
| English home           | [`public/en/index.html`](public/en/index.html)                   |
| English thanks         | [`public/en/thanks/index.html`](public/en/thanks/index.html)     |
| Impressum              | [`public/impressum/index.html`](public/impressum/index.html)     |
| Datenschutzerklärung   | [`public/datenschutz/index.html`](public/datenschutz/index.html) |
| Not found (both)       | [`public/404.html`](public/404.html)                             |

The demo it links to (demo.adsumus.ch) is described in
[`docs/DEMO.md`](../docs/DEMO.md).

## Before going live

1. **Legal pages.** For now the site runs under the club's identity: JAC
   Wohlen is the operator in the Impressum and the Datenschutzerklärung,
   with the contact address `kontakt@adsumus.ch` (forwarded to the
   club's Google Workspace; it must work before going live) and the demo
   database in Zürich. If the forwarding runs through another provider
   (e.g. Cloudflare Email Routing), name it in the Datenschutzerklärung. A `[[…]]` placeholder added later fails production
   deploys (the Netlify build command runs
   `node marketing/check-placeholders.mjs`); Deploy Previews only warn.
   Have the legal texts reviewed — they are a sensible starting point, not
   legal advice.
2. **Decide what the page promises.** Statements that are commitments, not
   just descriptions of the software, and need your OK:
   - _Preise_: "Pilotphase … Konditionen besprechen wir persönlich" (no
     prices are published).
   - _So startet ihr_ and the FAQ: you set up and run each club's instance
     ("Wir richten alles ein und betreiben es für euch"), a contract on
     data processing (Vertrag zur Auftragsbearbeitung) with each club, an
     export of the club's data when it leaves, an answer "innert weniger
     Tage". Webling is described as running at the home club only, with a
     per-club decision (not built for other clubs yet, see
     [`docs/CLUB_INSTANCES.md`](../docs/CLUB_INSTANCES.md#not-covered-yet)).
   - _Datenschutz_: "eigene Datenbank in Europa – auf Wunsch in Zürich"
     matches `region` in the club files (`eu-central-1` Frankfurt by
     default, `eu-central-2` Zürich).
3. **Screenshots**: `public/img/*.webp` (German) and `public/img/en/*.webp`
   (English) come from the demo seed; regenerate them with
   [`scripts/marketing-screenshots.mjs`](../scripts/marketing-screenshots.mjs)
   (`--lang en` for the English ones and `assets/og-image-en.png`) whenever
   the app's look changes.

## Releasing

The marketing site deploys from **`main`**, not `prod`: a change goes live
as soon as its pull request is merged, without a `main` → `prod` promotion.
The app keeps its own release flow; the two are separate Netlify sites and
never wait for each other. Every pull request gets a Deploy Preview of the
site (placeholders allowed there).

Keep in mind that the demo (demo.adsumus.ch) builds `prod`: describe a
new app feature on the site only once it is promoted, or the screenshots
and the demo disagree.

## Netlify setup (once)

The project already exists: **administra-marketing** in the team
"Andreas Schmid’s team" (https://app.netlify.com/projects/administra-marketing),
form detection on. What is left:

1. Project configuration → Build & deploy → **Link repository** → GitHub →
   `jacwohlen/administra`.
2. **Base directory: `marketing`**. Build command and publish directory
   come from [`marketing/netlify.toml`](netlify.toml) (`node
check-placeholders.mjs`, `public`). **Production branch: `main`**.
3. Domains: `adsumus.ch` as primary domain; `www.adsumus.ch`,
   `alleda.ch` and `www.alleda.ch` as aliases, which `netlify.toml`
   redirects to `https://adsumus.ch`. In the DNS of both domains: the apex
   to Netlify (A record `75.2.60.5`, or a flattened CNAME to
   `administra-marketing.netlify.app`) and `www` as a CNAME to
   `administra-marketing.netlify.app`, with any proxy off ("DNS only"), so
   Netlify can issue the certificates.
4. **Forms**: add an e-mail notification for the form `kontakt` to your
   address (Forms → Notifications). Netlify detects the form at deploy time
   from `data-netlify="true"`; spam is filtered by the honeypot field
   `website` and Netlify's spam filter.

The app's own Netlify site (repository root, `netlify.toml` there) does not
publish anything from `marketing/`.

## Editing

- German, Swiss spelling (ss, never ß), informal "ihr/du" like the app,
  sentence case, the ellipsis character … — see
  [`static/brand/README.md`](../static/brand/README.md#voice).
- English under `public/en/`: British English, product terms as in the
  app's English UI (`src/lib/i18n/locales/en.json`). Every change to the
  German home page goes into the English one in the same pull request (same
  sections, images and form fields; the tests compare them). Impressum and
  Datenschutzerklärung exist only in German; the English pages link to
  them as such.
- Every feature claim must be true for the current app. If a feature is
  JAC-only or not built for other clubs yet, say so or leave it out.
- Colours and type come from [`public/assets/tokens.css`](public/assets/tokens.css),
  an exact copy of `static/brand/tokens.css`; copy it again when the brand
  changes (a test fails until you do).
- No inline `style` attributes and no inline or third-party scripts: the
  Content Security Policy in `netlify.toml` allows only files from the site
  itself. `assets/theme.js` is the one script: it keeps a visitor's
  light/dark choice in `localStorage` (mentioned in the
  Datenschutzerklärung); without JavaScript the site follows the device's
  setting and the switch stays hidden.
- `npx vitest run marketing` checks links, anchors, images, the form,
  placeholders and the brand copies. To look at the site locally:
  `python3 -m http.server 8080 -d marketing/public`, then open
  http://localhost:8080 (the contact form only works on Netlify).
