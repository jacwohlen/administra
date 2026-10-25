# Club Instances: One Administra per Club

How Administra runs for clubs other than JAC Wohlen: each club gets its
**own Supabase project and its own Netlify site**, built from this same
repository. The app itself stays single-tenant; everything per-club lives
in configuration, and two scripts in `scripts/club-instances/` do the
setup and the updates.

Why separate instances instead of one multi-tenant database: no change to
the app's schema, RLS or queries; physical data separation per club; and a
first paying club within days. The price is roughly USD 10/month of
Supabase compute per club and one rollout step per release. Revisit
multi-tenancy once there are more than ~15–20 clubs.

## Overview

```
              PR ──► main ──► prod ──────────────► JAC Wohlen (unchanged:
                                │                  Supabase Branching + Netlify)
                                │
              rollout.js:       ▼
   1. migrate every club DB ── origin/prod's supabase/migrations
   2. push origin/prod ──────► branch `clubs` ──► every club's Netlify site rebuilds
```

| Piece                       | JAC Wohlen                         | Every other club                                    |
| --------------------------- | ---------------------------------- | --------------------------------------------------- |
| Database                    | Prod project, Supabase Branching   | Own project in the operator's Supabase organization |
| Migrations                  | Applied on merge to `prod`         | `rollout.js`, via the Management API                |
| Frontend                    | Netlify site building `prod`       | Own Netlify site building branch `clubs`            |
| `supabase/config.toml` auth | Applied by Branching               | Set by `provision.js` via the Management API        |
| Seed data                   | Never on Prod                      | Never                                               |
| First admin                 | `bootstrap_admins` row (migration) | `bootstrap_admins` replaced by `provision.js`       |

The `clubs` branch only ever moves forward, and only **after** every club
database has the new migrations, so no club site runs code that is newer
than its schema. If a club's migration fails, the rollout stops before
moving the branch: no site is rebuilt. Migrations must therefore stay
backwards compatible with the code currently deployed: between steps 1 and 2
the club sites still run the previous release against the new schema.

## The registry (outside this repo)

This repository is public. Club files name customers and their admins'
e-mail addresses, so they live in a separate **private** directory,
ideally its own private git repository, set as `CLUB_REGISTRY_DIR`:

```
clubs/
  judo-muster.json          # written by you, see scripts/club-instances/club.example.json
  judo-muster.state.json    # written by provision.js / rollout.js
```

Club file fields:

| Field                         | Required | Meaning                                                                       |
| ----------------------------- | -------- | ----------------------------------------------------------------------------- |
| `slug`                        | yes      | Same as the file name; names the project and site (`administra-<slug>`)       |
| `name`                        | yes      | Club name: public pages, mail sender                                          |
| `domain`                      | yes      | Where the club reaches Administra, e.g. `judo-muster.administra.ch`           |
| `adminEmails`                 | yes      | Become admin on first confirmed sign-in                                       |
| `sections`                    | yes      | `PUBLIC_CLUB_SECTIONS`                                                        |
| `defaultLocale`               | no       | `de` (default) or `en`                                                        |
| `region`                      | no       | Supabase region, default `eu-central-1` (Frankfurt). Zurich is `eu-central-2` |
| `url`, `logo`, `contactEmail` | no       | `PUBLIC_CLUB_URL`, `PUBLIC_CLUB_LOGO`, `PUBLIC_CLUB_CONTACT_EMAIL`            |

State files hold no secrets (project ref, site id, released commit). The
scripts never store database passwords or API keys: everything goes through
the operator's API tokens.

## Operator environment

Shared by all clubs, kept in your password manager, exported in the shell
that runs the scripts:

| Variable                                                                    | What                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `CLUB_REGISTRY_DIR`                                                         | Path of the registry directory                                                                        |
| `SUPABASE_ACCESS_TOKEN`                                                     | Supabase personal access token (dashboard → Account → Access tokens)                                  |
| `SUPABASE_ORG_SLUG`                                                         | Organization the club projects are created in                                                         |
| `NETLIFY_AUTH_TOKEN`                                                        | Netlify personal access token                                                                         |
| `NETLIFY_ACCOUNT_SLUG`                                                      | Netlify team the sites are created in                                                                 |
| `NETLIFY_GITHUB_INSTALLATION_ID`                                            | Netlify's GitHub App installation that can read this repo                                             |
| `GOOGLE_CLIENT_ID` / `_SECRET`                                              | One Google OAuth client shared by all clubs                                                           |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SENDER_EMAIL` | One transactional mail account (e.g. Resend, Postmark) for sign-in codes and trial mails of all clubs |
| `SMTP_SENDER_NAME`                                                          | Optional, default `Administra`                                                                        |
| `PUBLIC_SENTRY_DSN`                                                         | Optional, error reporting for all club sites                                                          |
| `ADMINISTRA_REPO`                                                           | Optional, default `jacwohlen/administra`                                                              |
| `CLUB_RELEASE_BRANCH`                                                       | Optional, default `clubs`                                                                             |

Custom SMTP is not optional in practice: Supabase's built-in mailer only
delivers to members of the Supabase organization, so without it nobody
could sign in with an e-mail code.

## One-time setup

1. A Supabase organization for the club projects (Pro plan: projects on the
   free plan are paused after a week without traffic).
2. A Netlify team, with the Netlify GitHub App installed on this repo.
3. A domain, e.g. `administra.ch`, for the club subdomains.
4. The Google OAuth client (Google Cloud Console). Each club adds one
   redirect URI (see below); the consent screen shows "Administra".
5. A transactional mail account with a verified sender domain.
6. Create the release branch once: `node scripts/club-instances/rollout.js`
   with an empty registry pushes `origin/prod` to `clubs`.

## Adding a club

```bash
cp scripts/club-instances/club.example.json "$CLUB_REGISTRY_DIR/judo-muster.json"
# edit it, then:
node scripts/club-instances/provision.js judo-muster --dry-run
node scripts/club-instances/provision.js judo-muster
```

`provision.js` does, and on a re-run completes:

1. Creates the Supabase project `administra-<slug>` (or finds it again) and
   waits until it is healthy (a few minutes).
2. Applies every migration of `origin/clubs`, the code the site will build,
   each in one transaction, recorded in `supabase_migrations.schema_migrations`
   exactly as `supabase db push` would. No seed data.
3. Replaces `public.bootstrap_admins` with the club's `adminEmails`, so the
   JAC admin address from the migration is not an admin there.
4. Sets the auth configuration the JAC projects get from `config.toml`:
   site URL and redirect allow list for the club's domain, Google sign-in,
   the sign-in code mail template, custom SMTP.
5. Creates the `avatars` storage bucket (declared in `config.toml`, which
   only Branching applies).
6. Creates the Netlify site `administra-<slug>`: builds branch `clubs`,
   custom domain, no deploy previews. Sets its environment variables
   (Supabase URL and key, `PUBLIC_MODE=PROD`, `PUBLIC_CLUB_*`, SMTP for
   trial mails) and starts the first build.

Then three manual steps, which the script prints with the exact values:

1. Add `https://<project-ref>.supabase.co/auth/v1/callback` to the Google
   OAuth client's redirect URIs (Google offers no API for this).
2. DNS: `CNAME <domain> → administra-<slug>.netlify.app`.
3. Ask the club's admin to sign in. They become admin on their first
   confirmed sign-in and approve everybody else from `/dashboard/users`.

## Releasing

After promoting `main` to `prod` (which releases JAC Wohlen as before):

```bash
node scripts/club-instances/rollout.js --dry-run   # what would be applied where
node scripts/club-instances/rollout.js
```

`--ref <commit>` releases something other than `origin/prod`. The rollout
refuses to move `clubs` backwards, and refuses databases whose migration
history contains versions the repo does not know (somebody changed them by
hand) or would skip an older repo migration.

## Not covered yet

- **Webling sync** for other clubs: `.github/workflows/webling-sync.yml`
  knows only the JAC environments. Clubs start with manual entry; a
  per-club sync needs the club's Webling credentials and a matrix over the
  registry.
- **Backups beyond Supabase's daily backups**, and a data export for clubs
  that leave.
- **Automatic rollout** on merge to `prod` (a workflow with the registry
  repo and tokens as secrets). Run it by hand until the process is proven.
- **Billing**: subscription state lives with the payment provider; a club
  that stops paying is paused with `POST /v1/projects/{ref}/pause`.
- **Removing a club**: delete the Netlify site and the Supabase project in
  the dashboards, then its two registry files.

## Verified so far

- The migration path of `provision.js` / `rollout.js` was run against a
  local, empty Supabase database: all migrations applied, a second run
  applied none, `supabase migration list` read the history, and the
  resulting `public` and `storage` schemas were identical to a
  `supabase db reset`.
- The bootstrap admin behaviour was tested locally (club admin becomes
  admin; the JAC address and unconfirmed addresses stay pending).
- The Supabase and Netlify requests follow the official OpenAPI specs, but
  have **not yet been run against real accounts**. Run the first club with
  `--dry-run`, then for real, and fix anything that differs here.
