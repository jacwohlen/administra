# Public demo (demo.alleda.ch)

A public, always-current Alleda for people considering it for their club: the made-up **Budo-Club Musterwil**,
entered with one click as Vorstand, Trainer/in or Mitglied, and reset to the
same fresh state every week. The marketing site ([`marketing/`](../marketing/README.md),
alleda.ch) links to it.

| Piece                                                                     | What                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Supabase project `administra-demo`                                        | Its own project — never a JAC Wohlen project, never a club instance                         |
| Netlify site `alleda-demo` for `demo.alleda.ch`                           | The normal app built from `prod` with `PUBLIC_MODE=DEMO`                                    |
| [`supabase/demo/seed.sql`](../supabase/demo/seed.sql)                     | The demo club: members, trainings, two seasons of attendance, exams, plan, trial candidates |
| [`supabase/checks/demo_seed.sql`](../supabase/checks/demo_seed.sql)       | Assertions run after every reset and in CI                                                  |
| [`.github/workflows/demo-reset.yml`](../.github/workflows/demo-reset.yml) | Weekly reset: wipe, migrate, seed, check, empty storage                                     |

## What `PUBLIC_MODE=DEMO` changes in the app

- The login page shows three role buttons instead of Google and the e-mail
  code. Each posts the role to the `demo` form action
  ([`src/routes/+page.server.ts`](../src/routes/+page.server.ts)), which
  signs in with the matching account from
  [`src/lib/server/demoAccounts.ts`](../src/lib/server/demoAccounts.ts).
  The action accepts nothing but a known role, allows each client 10
  sign-ins per 5 minutes, and answers 404 in every other mode.
- A strip on every page says that the data is made up and reset weekly,
  with a link to alleda.ch.

Everything else is the production app. With `PUBLIC_MODE=PROD` or `DEV`
none of this is reachable.

## Demo accounts

All with the password `administra-demo` — public on purpose, they exist
only in the demo project.

| Button                 | Account                   | Role                                                                                                    | Lands on     |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------ |
| Vorstand               | `vorstand@demo.alleda.ch` | admin (Sandra Keller)                                                                                   | `/dashboard` |
| Trainerin oder Trainer | `trainer@demo.alleda.ch`  | trainer + examiner (Marco Rossi), main trainer of _Judo Jugend_, which they plan themselves (see below) | `/dashboard` |
| Mitglied oder Eltern   | `mitglied@demo.alleda.ch` | member account of two children (Familie Brunner), approved via e-mail                                   | `/club`      |

The seed also adds one pending account (`neu@demo.alleda.ch`, no known
password), so the Vorstand sees an approval request under Benutzer.

The training plan (`docs/TRAINING_PLAN.md`) holds the three adult
trainings and _Judo Jugend_. Marco is the main trainer of _Judo Jugend_
(and of _Judo Kinder_, which is not in the plan) and not the TK, so as
Trainer a visitor plans exactly that one training (trainer, topic,
cancellations, rotation, table) and only reads the rest; as Vorstand (admin,
so also TK) everything, holidays and the planned trainings included.

## Keeping one visitor from breaking it for the next

Anyone can log in as admin, so the seed installs demo-only triggers (they
exist only in the demo database, not in the migrations; `supabase/demo/seed.sql`
section "Guards"):

- The three login accounts keep their password, e-mail, display name and
  avatar (changes through the API are silently reverted), cannot be
  deleted, cannot enrol an MFA factor, and their role, status, exam role
  and member link cannot be changed. The pending example request
  (`neu@…`) stays pending.
- The member records those accounts depend on (Sandra's, Marco's, the two
  Brunner children) cannot be deleted, archived, relabelled or get another
  e-mail, and no other member can be given a demo login's e-mail.
- Marco stays the main trainer of _Judo Jugend_, so the Trainer login can
  always plan it (other trainings' main trainers may change, by the
  Vorstand: only the TK sets main trainers and changes their e-mail, and
  the Trainer login is not the TK).
- The two exam days cannot be deleted or moved. When a visitor withdraws
  one of the Brunner children from the upcoming exam, the registration is
  removed, so the next visitor can register the child again; staff cannot
  start or close those two sheets.
- Seeded events, exam programs, planned trainings and trial candidates
  cannot be deleted (rows visitors add can). No statement may delete more
  than one seeded row at a time (ten for training plan sessions), so
  nobody wipes a whole list; deleting one member with its grades still
  works.
- Club name, website, logo, contact e-mail, sections and default language
  (all shown on the public Probetraining page) cannot be changed.

A refused change shows the app's normal error message; the database says
"In der Demo …". `supabase/checks/demo_seed.sql` tests every guard after
each reset.

Everything else is open on purpose: visitors should be able to record
attendance, edit members, plan trainings and grade an exam. The flip side:
whatever someone enters or changes (text, renamed events, uploaded photos)
is visible to the next visitors until the reset. A "log out everywhere"
or a password change through the auth API (the change itself is reverted)
also ends the other visitors' sessions of that role: one click to log in
again. The calendar links of the training plan (`docs/TRAINING_PLAN.md`)
are shared per role as well: anyone can renew them, which ends the other
visitors' subscriptions, and the reset deletes them all (`calendar_feeds`).
If that becomes a problem, reset daily
instead of weekly: one line in the workflow's `cron` (`'23 3 * * *'`) and
the wording "jede Woche" / "every week" in `demo.banner` and
`page.login.demo.intro` (both locales in `src/lib/i18n/locales/`), in the
FAQ of `marketing/public/index.html` and in the demo section of
`marketing/public/datenschutz/index.html`.

What the demo deliberately does **not** do:

- **No e-mails.** Leave every `PRIVATE_SMTP_*` unset: the public trial form
  would otherwise mail any address someone types in. Trial mails are logged
  as "nicht gesendet".
- **No Daten-Assistent.** Leave `PRIVATE_ANTHROPIC_API_KEY` unset: shared
  accounts would let anyone spend the AI budget.
- **No sign-ups.** In the demo project, sign-ups are disabled; only the
  seeded accounts exist.

## The weekly reset

[`.github/workflows/demo-reset.yml`](../.github/workflows/demo-reset.yml)
runs every Monday at 03:23 UTC, on every push to `prod` that touches
`supabase/migrations/` or `supabase/demo/` (so the demo database always
has the schema of the code the demo site runs), and by hand.

1. **Safety check**: refuses unless `DEMO_DB_URL` and `DEMO_SUPABASE_URL`
   belong to the same project, that project is not one of the JAC Wohlen
   projects, and its database is marked as the demo
   (`COMMENT ON DATABASE … 'administra-demo'`, set by the seed; the
   comment survives the reset). The seed itself also refuses a database
   that already has users or members.
2. `supabase db reset --db-url $DEMO_DB_URL --no-seed` drops everything
   (public schema, auth users, migration history) and applies `prod`'s
   migrations.
3. `psql -1 -f supabase/demo/seed.sql` loads the club in one transaction.
   All dates are relative to the day of the reset, so the club always looks
   current: attendance up to the previous days, an exam day open for
   registration, the training plan for the coming weeks.
   The exam programs are invented: the migration seeds the real club's
   Judo programs, and the seed replaces them before the exam sheets copy
   them (same grades and structure, techniques, tasks and questions chosen
   anew), so the club's own program is not published by the demo.
4. `supabase/checks/demo_seed.sql` checks the result (accounts, dates,
   guards, …).
5. The `avatars` and `lesson-plans` buckets are emptied through the
   Storage API: the reset keeps storage objects, and SQL may not delete
   them.

## Setting it up (once)

1. **Supabase**: create a project `administra-demo` in your organization
   (Pro plan, so it is never paused; region Zürich `eu-central-2`, as the
   Datenschutzerklärung says). `administra-demo` carries the product's first
   name (Administra) and stays on purpose: it is also the database marker in
   `demo-reset.yml` and the demo password in `demoAccounts.ts` and the
   seed; change the marker and the password only together with the seed. Then in its dashboard:
   - Authentication → Sign In / Providers: **disable "Allow new users to
     sign up"**; keep the Email provider enabled (password sign-in) with
     "Secure email change" on; leave Google and anonymous sign-ins off.
   - Authentication → Multi-Factor: turn TOTP and phone MFA off (shared
     accounts must not get a second factor).
   - Authentication → Rate Limits: raise **"Sign-ups and sign-ins"** far
     above the default (30 per 5 minutes per IP, e.g. to 1000). The demo
     signs in on the server, so all visitors share the few IPs of the
     Netlify function and with them one bucket; at the default a traffic
     spike (or one script) gets everyone the "sign-in failed" message. The
     app also throttles each visitor to 10 demo sign-ins per 5 minutes
     ([`demoRateLimit.ts`](../src/lib/server/demoRateLimit.ts)), but only per
     warm function instance.
   - Authentication → URL Configuration: Site URL
     `https://demo.alleda.ch`, no further redirect URLs needed.
   - Connect → **Session pooler** connection string (IPv4 — GitHub's
     runners have no IPv6), with the database password filled in.
   - Project Settings → API Keys: the publishable key (`sb_publishable_...`)
     for Netlify, a secret key (`sb_secret_...`) for the workflow (the
     legacy `anon` / `service_role` keys stop working at the end of 2026).
2. **GitHub** → Settings → Environments → new environment **`demo`**
   (allow the branches `main` and `prod`):
   - secret `DEMO_DB_URL`: the session pooler connection string
   - variable `DEMO_SUPABASE_URL`: `https://<project-ref>.supabase.co`
   - secret `DEMO_SUPABASE_SECRET_KEY`: the secret key
   - optional secret `DEMO_HEALTHCHECK_URL`: a healthchecks.io ping URL
     (weekly period), see [`UPTIME_MONITORING.md`](UPTIME_MONITORING.md)
3. **First reset**, once `prod` contains `supabase/demo/` (the job always
   checks out `prod`): Actions → Demo reset → Run workflow, branch `main`,
   tick **initialize** (the new database has no demo marker yet; this only
   works on a database without users and members). Later runs need
   nothing. Until the `demo` environment has its secrets, the weekly run
   only leaves a notice.
4. **Netlify**: a new site from this repository, base directory empty,
   production branch **`prod`**, deploy previews off (the live one is
   called `alleda-demo`). Environment variables:

   | Variable                       | Value                                 |
   | ------------------------------ | ------------------------------------- |
   | `PUBLIC_MODE`                  | `DEMO`                                |
   | `PUBLIC_SUPABASE_DATABASE_URL` | `https://<project-ref>.supabase.co`   |
   | `PUBLIC_SUPABASE_ANON_KEY`     | the publishable key                   |
   | `PUBLIC_SUPABASE_SITE_URL`     | `https://demo.alleda.ch`              |
   | `PUBLIC_SENTRY_DSN`            | optional, a Sentry project of its own |

   Nothing else: no `PRIVATE_SMTP_*`, no `PRIVATE_ANTHROPIC_API_KEY`. Club
   name, logo and sections come from the seed's `app_settings`.

5. **DNS**: `demo.alleda.ch` → CNAME to `alleda-demo.netlify.app`, as the
   site's primary domain.
6. **Mailbox**: the demo shows `demo@alleda.ch` as the club's contact
   (public Probetraining page, trial mails); make it an alias of your
   inbox, or change `club.contactEmail` in the seed.

A Sentry DSN, if you set one, should belong to a Sentry project of its own:
the demo site builds in Netlify's production context and would otherwise
report as `production`, mixed with JAC Wohlen's errors.

## Changing the schema

CI (`db-validate` in [`ci.yml`](../.github/workflows/ci.yml)) loads the
demo seed onto a fresh database and runs its checks on every pull request.
When a migration changes a table the seed fills (new NOT NULL column,
renamed column, new check), that job fails: update `supabase/demo/seed.sql`
in the same pull request. New features are worth a few rows in the seed
too, so the demo shows them.

## Running the demo locally

```bash
npx supabase start                       # once
npx supabase db reset --no-seed          # migrations only
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -1 -v ON_ERROR_STOP=1 -q -f supabase/demo/seed.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -v ON_ERROR_STOP=1 -q -f supabase/checks/demo_seed.sql
```

Then set `PUBLIC_MODE=DEMO` and the local anon key in `.env` and run
`npm run dev`. `npx supabase db reset` (with seed) brings back the normal
test data.

The marketing screenshots are taken from this local demo:
[`scripts/marketing-screenshots.mjs`](../scripts/marketing-screenshots.mjs).
