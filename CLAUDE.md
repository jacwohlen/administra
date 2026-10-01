# Administra

Attendance tracking app for martial arts clubs. SvelteKit frontend + Supabase (PostgreSQL) backend, deployed on Netlify.

## Commands

- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run check` - TypeScript / Svelte type checking
- `npm run lint` - Prettier + ESLint checks
- `npm run format` - Auto-format with Prettier
- `npm run test:unit` - Run Vitest unit tests

## Architecture

- **Frontend:** SvelteKit 2 + Svelte 4, Tailwind CSS + Skeleton UI, svelte-i18n (de/en)
- **Backend:** Supabase (PostgreSQL with RLS), Google OAuth. Members can also sign in with a one-time email code. New accounts land in `user_profiles` with status `pending`; accounts whose confirmed email matches a member record are approved automatically with role `member` (own profile + member directory in `/club`, see `docs/MEMBER_SIGN_IN.md`), all others must be approved by an admin. Staff roles are `viewer` (read), `trainer` (write) and `admin` (write + user management). RLS policies use `is_approved_user()` (any approved account), `is_staff()` (viewer and up), `is_writer()` and `is_admin()`; members reach their own rows through `my_member_ids()`.
- **Trial e-mails:** thank-you, waiting-list and training mails to trial candidates go through the club's SMTP server (`PRIVATE_SMTP_*`, `src/lib/server/mailer.ts`), logged in `trial_emails`; see `docs/TRIAL_EMAILS.md`
- **Deployment:** Netlify via `@sveltejs/adapter-netlify`
- **External sync:** Python scripts in `/webling-sync/` sync members/events from Webling API, scheduled daily by `.github/workflows/webling-sync.yml`

## Project Structure

- `src/routes/` - SvelteKit file-based routing (dashboard, members, trainings, events, stats; `club/` is the member self-service area)
- `src/lib/models.ts` - TypeScript interfaces for all data types
- `src/lib/utils.ts` - Shared utility functions
- `src/lib/supabase.ts` - Supabase client setup
- `src/lib/i18n/` - Internationalization with locale JSON files
- `supabase/migrations/` - Versioned SQL migrations
- `supabase/seed.sql` - Database seed data

## Conventions

- TypeScript strict mode enabled
- Variables and functions: camelCase
- Database columns: snake_case
- Svelte components: PascalCase filenames
- Routes: kebab-case directories
- Environment variables: `PUBLIC_*` for client-accessible, `PRIVATE_*` for server-only
- Formatting: Prettier (spaces, single quotes, no trailing commas, 100 char width)
- Dashboard pages show add/edit/delete controls only when `data.canWrite` (trainer/admin, from `src/routes/dashboard/+layout.ts`); create/edit routes redirect viewers in their `+page.ts`. RLS stays the real guard.

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
