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
- **Backend:** Supabase (PostgreSQL with RLS), Google OAuth (restricted to @jacwohlen.ch)
- **Deployment:** Netlify via `@sveltejs/adapter-netlify`
- **External sync:** Python scripts in `/webling-sync/` sync members/events from Webling API

## Project Structure

- `src/routes/` - SvelteKit file-based routing (dashboard, members, trainings, events, stats)
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

## Database Migrations

Create new migrations with: `supabase migration new <name>`
Apply migrations locally: `supabase db reset`
Push to remote: `supabase db push`
