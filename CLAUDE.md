# Administra

Attendance tracking app for martial arts clubs. SvelteKit frontend + Supabase (PostgreSQL) backend, deployed on Netlify.

## Commands

- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run check` - TypeScript / Svelte type checking
- `npm run lint` - Prettier + ESLint checks
- `npm run format` - Auto-format with Prettier
- `npm run test:unit` - Run Vitest unit tests
- `cd webling-sync && ruff check . && pytest` - Lint and test the Webling sync (`pip install -r requirements-dev.txt`)

## Architecture

- **Frontend:** SvelteKit 2 + Svelte 4, Tailwind CSS + Skeleton UI, svelte-i18n (de/en)
- **Backend:** Supabase (PostgreSQL with RLS), Google OAuth. Members can also sign in with a one-time email code. New accounts land in `user_profiles` with status `pending`; accounts whose confirmed email matches a member record are approved automatically with role `member` (own profile + member directory in `/club`, see `docs/MEMBER_SIGN_IN.md`), all others must be approved by an admin. Staff roles are `viewer` (read), `trainer` (write) and `admin` (write + user management). RLS policies use `is_approved_user()` (any approved account), `is_staff()` (viewer and up), `is_writer()` and `is_admin()`; members reach their own rows through `my_member_ids()`.
- **Q-Prüfungen (kyu gradings):** exam days, member self-registration, a phone sheet on which examiners score a pair side by side, and the result written to `member_grades`; programs per grade live in `exam_programs`. On top of a staff role, `user_profiles.exam_role` makes an account an `examiner` (scores the sheet, `is_examiner()`) or the TK `manager` (also exam days and programs, `is_exam_manager()`); admins have both. Members see only exam days, their registrations and the resulting grade, never sheets, points or programs (see `docs/Q_EXAMS.md`, scoring in `src/lib/examUtils.ts`)
- **Trainingsplanung (training plan):** the TK (`exam_role` `manager`, admins included) plans trainer, topic and cancellations per training and date for the trainings in `training_plan_trainings` (`training_plan_sessions`), with holidays as `training_plan_breaks` (school holidays shown, `cancels_training` when the dojo is closed) and an import of the old Google Sheet (`src/lib/trainingPlanImport.ts`); all staff read it, the check-in page shows the plan for its date. Rotation and plan logic in `src/lib/trainingPlanUtils.ts`, see `docs/TRAINING_PLAN.md`
- **Trial e-mails:** thank-you, waiting-list and training mails to trial candidates go through the club's SMTP server (`PRIVATE_SMTP_*`, `src/lib/server/mailer.ts`), logged in `trial_emails`; see `docs/TRIAL_EMAILS.md`
- **Error monitoring:** Sentry (`@sentry/sveltekit`, EU region) in `hooks.server.ts` / `hooks.client.ts`; reports are scrubbed by `src/lib/sentryScrub.ts` (no e-mails, OAuth codes, IPs). Off without `PUBLIC_SENTRY_DSN`; see `docs/ERROR_MONITORING.md`. Uptime: an external monitor calls `/api/health`; the Webling sync reports each run to healthchecks.io (`docs/UPTIME_MONITORING.md`)
- **Deployment:** Netlify via `@sveltejs/adapter-netlify`
- **External sync:** Python scripts in `/webling-sync/` sync members/events from Webling API, scheduled daily by `.github/workflows/webling-sync.yml`. Webling ids are written into `members.id` / `events.id`; the app's own ids start at 10'000'001 so they never collide. Registrations the sync inserts are marked by `notes` starting with `Imported from Webling`; it only ever removes those, never rows added in the app. `member_links` records which members come from Webling (`gone_at` once Webling no longer has them: status `left`); while in Webling their name, birthday, contact and groups are read-only in the app (`trigger_guard_provider_fields`). `members.membership_status` is derived from the labels (`member_status_from_labels()`, helpers in `src/lib/memberStatus.ts`); integration plan and decisions in `docs/INTEGRATIONS.md`

## Project Structure

- `src/routes/` - SvelteKit file-based routing (dashboard, members, trainings, training-plan, events, exams, stats; `club/` is the member self-service area)
- `src/lib/models.ts` - TypeScript interfaces for all data types
- `src/lib/utils.ts` - Shared utility functions
- `src/lib/supabase.ts` - Supabase client setup
- `src/lib/i18n/` - Internationalization with locale JSON files
- `supabase/migrations/` - Versioned SQL migrations
- `supabase/seed.sql` - Database seed data
- `static/brand/` - Brand guide extracted from the app (logo, `tokens.css`/`tokens.json`, style sheet at `/brand/`); not imported by the app, update it when the theme or `src/app.css` changes

## Conventions

- TypeScript strict mode enabled
- Variables and functions: camelCase
- Database columns: snake_case
- Svelte components: PascalCase filenames
- Routes: kebab-case directories
- Environment variables: `PUBLIC_*` for client-accessible, `PRIVATE_*` for server-only
- Formatting: Prettier (spaces, single quotes, no trailing commas, 100 char width)
- Dashboard pages show add/edit/delete controls only when `data.canWrite` (trainer/admin, from `src/routes/dashboard/+layout.ts`); create/edit routes redirect viewers in their `+page.ts`. Q-Prüfungen use `data.canManageExams` (exam days, programs), `data.canGrade` (sheets) and `canWrite || canManageExams` (candidates) instead; the training plan uses `data.canPlanTrainings`. RLS stays the real guard.

## Database Migrations

Create new migrations with: `supabase migration new <name>`
Apply migrations locally: `supabase db reset`

Migrations deploy through Supabase Branching (see
`docs/SUPABASE_BRANCHING.md`): each PR gets an ephemeral Supabase preview
branch (migrations + seed applied, Netlify Deploy Preview points at it);
merging to `main` applies new migrations to the Dev project
(main.admin.jacwohlen.ch), and promoting `main` into `prod` applies them
to production (admin.jacwohlen.ch). Never edit an already-merged
migration — add a new one. Manual `supabase db push` is only a fallback.

## Production Releases

A prod release is a promotion PR `main` → `prod`, merged with a merge
commit (never squash). The PR body and the merge commit message list the
release's high-level features, fixes and included migrations — see the
`prod-release` skill (`.claude/skills/prod-release/SKILL.md`).
