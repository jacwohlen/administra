# Alleda

Attendance tracking app for martial arts clubs (formerly Administra and Adsumus: the repository, package, file and project names such as `administra-logo.svg` or `administra-demo` keep the old name). SvelteKit frontend + Supabase (PostgreSQL) backend, deployed on Netlify.

## Commands

- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run check` - TypeScript / Svelte type checking
- `npm run lint` - Prettier + ESLint checks
- `npm run format` - Auto-format with Prettier
- `npm run test:unit` - Run Vitest unit tests
- `npm run perf:bundle` (after a build) / `npm run perf:measure` - Bundle size per route / page loads in Chromium (`docs/PERFORMANCE.md`)
- `cd webling-sync && ruff check . && pytest` - Lint and test the Webling sync (`pip install -r requirements-dev.txt`)

## Architecture

- **Frontend:** SvelteKit 2 + Svelte 5 (runes), Tailwind CSS + Skeleton UI, svelte-i18n (de/en)
- **Backend:** Supabase (PostgreSQL with RLS), Google OAuth. Members can also sign in with a one-time email code. New accounts land in `user_profiles` with status `pending` and role `member`; accounts whose confirmed email matches an active or passive member record are approved automatically (own profile + member directory in `/club`, see `docs/MEMBER_SIGN_IN.md`), all others must be approved by an admin. A `member` account only gets in while one of its member records is active or passive, not archived and not a trial (`member_grants_access()`), checked per query by `is_approved_user()` / `my_member_ids()`, never stored; the app routes with `homePath(profile, access)` from `my_access()`, and `/pending` says why. Staff roles are `viewer` (read), `trainer` (write) and `admin` (write + user management). RLS policies use `is_approved_user()` (staff, or a member account whose membership counts), `is_staff()` (viewer and up), `is_writer()` and `is_admin()`; members reach their own rows through `my_member_ids()`, and other members' badges, grades, medals and photos only for `club_member_ids()` (own members + the directory); RPCs taking a member id check `can_see_member()`, and `supabase/checks/member_data.sql` fails for an API function bypassing RLS that is not listed there with its guard.
- **Q-Prüfungen (kyu gradings):** exam days, member self-registration, a phone sheet on which examiners score a pair side by side, and the result written to `member_grades`; programs per grade live in `exam_programs`. On top of a staff role, `user_profiles.exam_role` makes an account an `examiner` (scores the sheet, `is_examiner()`) or the TK `manager` (also exam days and programs, `is_exam_manager()`); admins have both. Members see only exam days, their registrations and the resulting grade, never sheets, points or programs (see `docs/Q_EXAMS.md`, scoring in `src/lib/examUtils.ts`)
- **Trainingsplanung (training plan):** the TK (`exam_role` `manager`, admins included) plans trainer, topic and cancellations per training and date for the trainings in `training_plan_trainings` (`training_plan_sessions`; a trainer who is a planned training's main trainer plans its dates too: `my_main_training_ids()`, in the UI `data.plannableIds`; only the TK sets `trainings."mainTrainerId"`: trigger `trainings_guard_main_trainer`, and changes a main trainer's e-mail outside Webling, since `my_member_ids()` finds members by e-mail: `members_guard_main_trainer_email`), with holidays as `training_plan_breaks` (school holidays shown, `cancels_training` when the dojo is closed), imported through the Daten-Assistent (kind `training_plan`, also a copied Google Sheet); all staff read it, the check-in page shows the plan for its date. Staff also subscribe to it as ICS feeds (_Meine Trainings_, _Alle Trainings_) at `/api/calendar/<token>/<feed>.ics`: the secret, renewable token per account (`calendar_feeds`, `calendar_feed_token()`) is the only key, `calendar_feed()` (callable by anon) returns the plan data for it, and `src/lib/calendarFeed.ts` builds the events with `buildPlan()`, cancelled dates kept as "Fällt aus: …" (never `STATUS:CANCELLED`). Planners tell trainers about plan changes by e-mail, manually (_Trainer informieren_): what each trainer was last told is stored per member (`training_plan_told_trainings` / `training_plan_told`, written by `training_plan_set_told()`) and compared with `buildPlan()` in `src/lib/trainingPlanMail.ts`; `/api/training-plan/notify` recomputes, checks a fingerprint and sends one address per request (Reply-To the sender), and mails leave only under `PUBLIC_MODE=PROD` (`planMailMode()`; the demo and Dev simulate); addresses from `training_plan_mail_addresses()` (a member's `*.invalid` address wins over a linked account's), opt-outs `training_plan_mail_optouts`, log `training_plan_mails`; notes are never mailed. Rotation and plan logic in `src/lib/trainingPlanUtils.ts`, see `docs/TRAINING_PLAN.md`
- **Daten-Assistent (AI import):** a photo, PDF or pasted text is read by Claude into a proposal (Judo pass gradings, attendance list, training plan, lesson plan, club dates) that the user reviews, completes and corrects before the browser saves it under RLS; the model has no tools, sees no member data and only answers in a fixed schema (`src/lib/server/assistant/`), every answer is re-checked (`src/lib/assistant/proposals.ts`), names are matched in the browser (`src/lib/assistant/nameMatch.ts`), and `ai_import_begin()` checks the role per kind and the daily limits (`ai_imports`). Off without `PRIVATE_ANTHROPIC_API_KEY`; see `docs/AI_ASSISTANT.md`
- **Trial e-mails:** thank-you, waiting-list and training mails to trial candidates go through the club's SMTP server (`PRIVATE_SMTP_*`, `src/lib/server/mailer.ts`), logged in `trial_emails`; `sendMail()` never sends under `PUBLIC_MODE=DEMO` or to `*.invalid` addresses (skipped); see `docs/TRIAL_EMAILS.md`
- **Duplicate members:** admins merge a duplicate (trial row and later Webling row, two app rows) with `merge_members(keep, drop)`: every reference moves in one transaction (the reviewed list `merge_member_references()`; the merge refuses an unknown foreign key to `members`), the Webling row must stay, `merge_members_preview()` is the same code rolled back, `member_merges` logs each merge. UI: member page menu and `/dashboard/members/duplicates` (`src/lib/memberDuplicates.ts`, `src/lib/memberMerge.ts`); a new foreign key to `members` needs a rule there first (`supabase/checks/merge_members.sql`), see `docs/INTEGRATIONS.md`
- **J+S export:** attendance of J+S courses as CSV files for the NDS import (`/dashboard/js`, `src/lib/jsExport.ts`), an optional module switched on the Integrations page (connection `js`), for trainers and admins only (RLS `is_writer()`, `data.jsEnabled`); persons are identified by `members.license_number` (Lizenznummer), synced from Webling when that integration is on, else entered in the app; see `docs/JS_EXPORT.md`
- **Error monitoring:** Sentry (`@sentry/sveltekit`, EU region) in `hooks.server.ts` / `hooks.client.ts`; reports are scrubbed by `src/lib/sentryScrub.ts` (no e-mails, OAuth codes, IPs). Off without `PUBLIC_SENTRY_DSN`; see `docs/ERROR_MONITORING.md`. Performance: traces with `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (default 0.2, request URLs' query values filtered by `scrubTransaction`); loads must not wait on each other without need (`hooks.client.ts` starts the settings, queries start alongside `await parent()`, first-view data in `+page.ts`), the server checks the session with `getClaims()`, the language is set with `setAppLocale()` (one locale file); see `docs/PERFORMANCE.md`. Uptime: an external monitor calls `/api/health`; the Webling sync reports each run to healthchecks.io (`docs/UPTIME_MONITORING.md`)
- **Deployment:** Netlify via `@sveltejs/adapter-netlify`
- **Public demo:** demo.alleda.ch runs the app with `PUBLIC_MODE=DEMO` (one-click role logins through the `demo` form action, demo banner) on its own Supabase project, reset weekly with `supabase/demo/seed.sql` by `.github/workflows/demo-reset.yml`; see `docs/DEMO.md`. The marketing site alleda.ch is static HTML in `marketing/` (own Netlify site deploying from `main`, no `prod` promotion; see `marketing/README.md`)
- **External sync:** The Webling adapter in `/webling-sync/` (entry point `src/sync.py`) feeds members/events from the Webling API into the integration layer, scheduled daily by `.github/workflows/webling-sync.yml`. Webling ids are written into `members.id` / `events.id`; the app's own ids start at 10'000'001 so they never collide. Registrations the sync inserts are marked by `event_participants.source_connection` and `notes` starting with `Imported from Webling`; it only ever removes those, never rows added in the app. `member_links` records which members come from Webling (`gone_at` once Webling no longer has them: status `left`); while in Webling their name, birthday, contact and groups are read-only in the app (`trigger_guard_provider_fields`). Duplicates are merged in the app (the Webling row stays), never by the sync. `members.membership_status` is derived from the labels (`member_status_from_labels()`, for linked members from phase 2 on the catalog `integration_member_groups` with the same result; helpers in `src/lib/memberStatus.ts`; the layer's apply refuses mass changes (members gone, status drop or gain, events gone) unless a manual run passes the exact number as `accept_gone`/`accept_status_drop`/`accept_status_gain`/`accept_events_gone`); integration plan and decisions in `docs/INTEGRATIONS.md`. Phase 2 adds a provider-neutral ingest layer in SQL (`integration_begin`/`stage`/`apply`/`finish`, catalogs `integration_member_groups`/`integration_calendars`, `field_policy`, run log `integration_runs`/`integration_issues`; `supabase/checks/integration_layer.sql`); events a provider still has (`event_links`) cannot be deleted in the app, and their edit page locks the fields the provider owns (`field_policy`; the registration deadline stays the app's); since phase 3 the sync runs only through it (3c removed the legacy scripts and `INTEGRATION_MODE`; a database without the layer is an error). The app reads the catalog once per session for staff (hidden labels, trainer groups, provider names: `src/lib/integrationConfig.ts`, built-in rules as fallback); admins see connections, runs, issues and the group/calendar mapping editor on `/dashboard/integrations` (`src/lib/integrations.ts`, warning dot on the avatar). Phase 4: events have a last day (`events.date_to`, inclusive) and `all_day` (for a Webling event locked on its edit page with the dates and times, while its description becomes the app's: `lockedEventFields()` in `src/lib/eventLinks.ts`), so every date filter on events is an overlap (`endsOnOrAfter()` in `src/lib/eventUtils.ts`); Webling's "Ferien und Feiertage" become `training_plan_breaks` through the layer (`supabase/checks/event_dates.sql`)

## Project Structure

- `src/routes/` - SvelteKit file-based routing (dashboard, members, trainings, training-plan, events, exams, stats, js; admins: users, settings, integrations; `club/` is the member self-service area)
- `src/lib/models.ts` - TypeScript interfaces for all data types
- `src/lib/utils.ts` - Shared utility functions
- `src/lib/supabase.ts` - Supabase client setup
- `src/lib/i18n/` - Internationalization with locale JSON files
- `supabase/migrations/` - Versioned SQL migrations
- `supabase/seed.sql` - Database seed data (local, CI, preview branches)
- `supabase/demo/seed.sql` - The made-up demo club for demo.alleda.ch, all dates relative to the reset day; checked by `supabase/checks/demo_seed.sql`
- `marketing/` - The marketing site alleda.ch (static HTML/CSS)
- `static/brand/` - Brand guide extracted from the app (logo, `tokens.css`/`tokens.json`, style sheet at `/brand/`); not imported by the app, update it when the theme or `src/app.css` changes

## Conventions

- TypeScript strict mode enabled
- Variables and functions: camelCase
- Database columns: snake_case
- Svelte components: PascalCase filenames
- Routes: kebab-case directories
- Environment variables: `PUBLIC_*` for client-accessible, `PRIVATE_*` for server-only
- Formatting: Prettier (spaces, single quotes, no trailing commas, 100 char width)
- Dashboard pages show add/edit/delete controls only when `data.canWrite` (trainer/admin, from `src/routes/dashboard/+layout.ts`); create/edit routes redirect viewers in their `+page.ts`. Q-Prüfungen use `data.canManageExams` (exam days, programs), `data.canGrade` (sheets) and `canWrite || canManageExams` (candidates) instead; the training plan uses `data.canPlanTrainings` (settings, import) and `data.plannableIds` (the trainings whose dates the account plans: the TK all, a main trainer their own). RLS stays the real guard.

## Database Migrations

Create new migrations with: `supabase migration new <name>`
Apply migrations locally: `supabase db reset`

A new migration's version must sort after every migration in
`supabase/migrations` (Branching applies new files in version order and
does not run one older than the newest applied). Some versions from
late October 2026 run ahead of the calendar: until it catches up, rename
the file `supabase migration new` creates to a version after the newest.

Migrations deploy through Supabase Branching (see
`docs/SUPABASE_BRANCHING.md`): each PR gets an ephemeral Supabase preview
branch (migrations + seed applied, Netlify Deploy Preview points at it);
merging to `main` applies new migrations to the Dev project
(main.admin.jacwohlen.ch), and promoting `main` into `prod` applies them
to production (admin.jacwohlen.ch). Never edit an already-merged
migration — add a new one. Manual `supabase db push` is only a fallback.

Other clubs run their own Supabase project + Netlify site from this repo
(see `docs/CLUB_INSTANCES.md`): `scripts/club-instances/rollout.js` applies
`prod`'s migrations to every club database, then moves branch `clubs`, which
the club sites build. So migrations must work while the previous release is
still deployed, must not depend on `config.toml` or seed data, and must not
hard-code JAC Wohlen specifics (addresses, sections) — use settings or
`bootstrap_admins` instead.

The public demo loads `supabase/demo/seed.sql` onto the migrations alone
(no `seed.sql`), and CI (`db-validate`) checks it on every PR: when a
migration changes a table the demo seed fills, update the demo seed in the
same PR (see `docs/DEMO.md`).

## Production Releases

A prod release is a promotion PR `main` → `prod`, merged with a merge
commit (never squash). The PR body and the merge commit message list the
release's high-level features, fixes and included migrations — see the
`prod-release` skill (`.claude/skills/prod-release/SKILL.md`).
