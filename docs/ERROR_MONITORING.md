# Error monitoring (Sentry)

Unexpected errors are reported to [Sentry](https://sentry.io) (EU region,
Frankfurt), so we hear about a broken page before a trainer has to tell us.
Without `PUBLIC_SENTRY_DSN` nothing is sent (local development, tests, CI).

## What is reported

- Unexpected errors on the server (load functions, form actions, API
  routes, crashes in the Netlify function) and in the browser (uncaught
  errors and promise rejections, failed navigations).
- Expected errors such as 404 or a `redirect` are not.
- Neither are dropped connections in the browser ("Failed to fetch", "Load
  failed") or files from an old deploy that a page preloaded: they say
  nothing about our code (`browserNetworkNoise` in `src/lib/sentry.ts`), and
  SvelteKit reloads the page by itself.
- Each report has the page (route), browser, release (Git commit) and the
  steps leading up to it (navigation, clicks, requests).

## Privacy

- `dataCollection` in `src/lib/sentry.ts`: no IP addresses, cookies,
  request or response bodies, AI prompts and answers, database query data
  or local variables of stack frames, and only a few harmless request
  headers (Netlify adds the client IP and location under its own header
  names, which Sentry's IP filter does not know). (Sentry 11 replaced `sendDefaultPii`
  with this option and collects all of it by default.) This matters for the
  Daten-Assistent (docs/AI_ASSISTANT.md), whose uploads and answers hold
  names and birthdays.
- `src/lib/sentryScrub.ts` removes from every report, before it leaves the
  app: values of sensitive query parameters (`?code=` from the OAuth
  callback, `?email=` on the login page, OAuth and provider tokens), the
  token in `/probetraining/status/<token>` (it gives access to a trial
  registration) and e-mail addresses. Add any new route with a secret in
  its path to `TOKEN_PATH` there.
- Browser reports carry the account ID (`auth.users.id`) only, never a name
  or e-mail, so a report can be matched to a `user_profiles` row if needed.
- Error messages can still contain other data, e.g. a member's name in a
  database error. Keep Sentry's server-side data scrubbing on (Project
  Settings → Security & Privacy, default) and give only admins access.

## Error ID

The error page (`src/routes/+error.svelte`) shows a "Fehler-ID" for every
reported error. Paste it into Sentry's search to find the exact report.

## Environments

From Netlify's deploy context at build time (`src/lib/sentry.ts`):

| Sentry environment | Netlify context | Site                    |
| ------------------ | --------------- | ----------------------- |
| `production`       | production      | admin.jacwohlen.ch      |
| `dev`              | branch-deploy   | main.admin.jacwohlen.ch |
| `preview`          | deploy-preview  | PR Deploy Previews      |

## Code

- `src/lib/sentry.ts`: shared settings (DSN, environment, scrubbing)
- `src/hooks.server.ts`, `src/hooks.client.ts`: `Sentry.init`,
  `sentryHandle` and `handleErrorWithSentry`
- `src/routes/+layout.svelte`: sets the account ID
- `vite.config.js`: source map upload (only with `SENTRY_AUTH_TOKEN`); the
  maps are deleted from the build afterwards, so they are never public

## Setup (once)

1. Create a free account at sentry.io with the **EU (Frankfurt)** data
   region (or use the club's existing organisation).
2. Create a project of type **SvelteKit**, named e.g. `administra`.
3. In Netlify → Site configuration → Environment variables:
   - `PUBLIC_SENTRY_DSN`: Project Settings → Client Keys (DSN). Not secret,
     it ends up in the browser anyway. Same value for all contexts.
   - `SENTRY_AUTH_TOKEN`: Settings → Developer Settings → Organization
     Tokens (scope "builds only"). Mark it **secret** and keep it from fork
     Deploy Previews (sensitive variable policy), the repo is public.
   - `SENTRY_ORG`, `SENTRY_PROJECT`: the slugs from the project's URL.
4. Alerts → Create alert → Issues: e-mail on a **new** issue in the
   `production` environment (and `dev` if you like).
5. Optional: Settings → Integrations → GitHub, to create an issue from an
   error with one click.
