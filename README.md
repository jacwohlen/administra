# Adsumus - Attendance Tracking System

A modern attendance tracking system designed specifically for martial arts clubs and training organizations (formerly Administra; the repository `jacwohlen/administra` and its identifiers keep that name). Built with SvelteKit and Supabase, Adsumus makes it easy to manage training sessions, track attendance, and generate insightful statistics.

## Features

- **Member Management** - Maintain a database of athletes and trainers with profile information and flexible labeling
- **Training Sessions** - Create and manage recurring training classes with metadata (title, schedule, section)
- **Attendance Tracking** - Quick and easy attendance marking for each training date
- **Statistics & Leaderboards** - View comprehensive attendance statistics, top athletes, and trainer activity by year and section
- **Secure Authentication** - Google OAuth or passwordless email code, admin approval and role-based access (member / viewer / trainer / admin)
- **Member Self-Service** - Members sign in with the email the club has on file and see their own profile and the member directory
- **Q-Prüfungen (Kyu Gradings)** - Members register for exam days, examiners score candidates on their phone, passing records the new belt; the TK and examiners are exam roles set in the user management (see `docs/Q_EXAMS.md`)
- **Trainingsplanung (Training Plan)** - The TK plans trainers, topics, rotations and holidays of the adult trainings for the year, replacing the shared document (see `docs/TRAINING_PLAN.md`)
- **Daten-Assistent (AI Import)** - Read Judo passes, attendance lists, training plans, lesson plans and club dates from a photo, PDF or pasted text with Claude; the user reviews, completes and corrects the proposal before anything is saved, and the model can do nothing but propose (see `docs/AI_ASSISTANT.md`)
- **Multi-language Support** - Built-in internationalization (German/English)
- **Responsive Design** - Works seamlessly across desktop and mobile devices

## Tech Stack

- **Frontend**: SvelteKit with TypeScript
- **Styling**: Tailwind CSS + Skeleton UI
- **Backend**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth with Google OAuth and email one-time codes
- **Charts**: Carbon Charts
- **Deployment**: Netlify
- **Icons**: FontAwesome (via svelte-fa)

## Quick Start

### Prerequisites

- Node.js (LTS version recommended - use `nvm install --lts`)
- A Supabase account and project
- npm, pnpm, or yarn

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd administra
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

Create a `.env` file in the root directory:

```bash
PUBLIC_SUPABASE_DATABASE_URL="your-supabase-project-url"
PUBLIC_SUPABASE_ANON_KEY="your-supabase-publishable-key"  # sb_publishable_..., the name is historic
PUBLIC_MODE="DEV"  # Use "PROD" for production, "DEMO" only for the public demo
```

These are required. Club-specific settings (name, website, logo, sections,
trial threshold, default language) are optional `PUBLIC_CLUB_*` variables
with sensible defaults — see `.env.example` for the full list and
`src/lib/clubConfig.ts` for how they are parsed.

4. Set up the Supabase database (see [Database Setup](#database-setup) below)

5. Start the development server:

```bash
npm run dev

# Or open in browser automatically
npm run dev -- --open
```

The application will be available at `http://localhost:5173`

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run check` - Type check with svelte-check
- `npm run check:watch` - Type check in watch mode
- `npm run lint` - Run Prettier and ESLint checks
- `npm run format` - Format code with Prettier
- `npm run test:unit` - Run unit tests with Vitest
- `npm run test:e2e` - Run end-to-end tests with Playwright

### Testing

**Unit tests** use Vitest with jsdom for component testing:

```bash
npm run test:unit          # Watch mode
npm run test:unit -- --run # Single run (used in CI)
```

Tests cover:

- Utility functions (date handling, weekday mapping)
- Business logic (attendance stats, streak calculation, training sorting, stats grouping)
- Member form logic (label add/remove/dedup, form validation)
- Keyboard navigation (list traversal, wrapping, participant filtering)
- Route load functions (with mocked Supabase client)
- Svelte components (Labels, ParticipantFrequency)
- i18n locale key parity (en/de)

**E2E tests** use Playwright (Chromium):

```bash
npx playwright install chromium  # First time only
npm run test:e2e                 # Public tests only (login, auth guards)
```

**Authenticated E2E tests** require a running Supabase instance with seed data and a test user:

```bash
# Start local Supabase and seed data
supabase start && supabase db reset

# Create a test user (once) via Supabase Dashboard or SQL
# Then run with auth env vars:
E2E_USER_EMAIL=test@example.com E2E_USER_PASSWORD=testpass npm run test:e2e
```

Authenticated tests cover dashboard navigation, members list/search/profile, trainings list/attendance, and stats page; `memberAccess.spec` signs in as the seeded `member@example.com` and `former@example.com`.

### CI Pipeline

GitHub Actions runs automatically on pushes to `main` and pull requests. The pipeline has these jobs:

| Job                | What it runs                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **lint-and-check** | Prettier, ESLint, svelte-check                                                                                        |
| **unit-tests**     | All Vitest unit and component tests                                                                                   |
| **e2e-tests**      | Playwright browser tests (uploads HTML report as artifact)                                                            |
| **db-validate**    | Migrations + seed on a fresh database, `supabase db lint`, member access checks (`supabase/checks/member_access.sql`) |
| **build**          | Production build (waits for lint + unit tests to pass)                                                                |

### Project Structure

```
src/
├── lib/
│   ├── i18n/              # Internationalization files
│   ├── test/              # Test setup and utilities
│   ├── models.ts          # TypeScript type definitions
│   ├── clubConfig.ts      # Club settings for the app (reads PUBLIC_CLUB_* env)
│   ├── clubConfigParser.ts # Pure parsing and defaults, unit-tested
│   ├── supabase.ts        # Supabase client configuration
│   ├── utils.ts           # Shared utility functions
│   ├── statsUtils.ts      # Statistics grouping and year param logic
│   ├── trainingUtils.ts   # Streak calculation, training sorting
│   ├── attendanceUtils.ts # Attendance filtering and stats
│   ├── eventUtils.ts      # Event date and registration logic
│   ├── memberFormUtils.ts # Label management and form validation
│   └── keyboardNavUtils.ts # List keyboard navigation and participant filtering
├── routes/
│   ├── dashboard/         # Main application routes
│   │   ├── members/       # Member management
│   │   ├── trainings/     # Training session management
│   │   ├── training-plan/ # Trainingsplanung: trainers, topics, holidays
│   │   ├── events/        # Event management
│   │   ├── exams/         # Q-Prüfungen: exam days, scoring sheets, programs
│   │   └── stats/         # Statistics and reports
│   └── +layout.svelte     # Root layout with auth
e2e/                       # Playwright E2E tests
webling-sync/              # External member sync tool
```

## Database Setup

The application requires a Supabase PostgreSQL database with specific tables, views, functions, and security policies.

### Prerequisites

- Supabase CLI installed (`npm install -g supabase`)
- Supabase project created

### Local Development with Supabase

For local development, use the Supabase CLI to run a full Supabase stack locally (PostgreSQL, Auth, Storage, Studio):

1. **Start local Supabase:**

```bash
supabase start
```

This starts PostgreSQL on port 54322, the API on port 54321, and Studio on port 54323. Use the `API URL` and the publishable key printed in the output for your `.env` file (`PUBLIC_SUPABASE_ANON_KEY`; older CLI versions print only the legacy `anon key`, which works locally too).

2. **Apply migrations and seed data:**

```bash
supabase db reset
```

This drops and recreates the database, runs all migrations from `supabase/migrations/`, and loads `supabase/seed.sql`.

3. **Create a new migration:**

```bash
supabase migration new <name>
```

4. **Stop local Supabase:**

```bash
supabase stop
```

### Remote Database Setup

1. **Link to your Supabase project:**

```bash
supabase link --project-ref your-project-ref
```

2. **Apply all migrations:**

```bash
supabase db push
```

### Database Structure

**Core Tables:**

- `members` - Athletes and trainers with profile information
- `trainings` - Training session definitions and schedules
- `participants` - Member enrollment in training sessions
- `logs` - Attendance records with date and trainer status
- `events` - General events and activities
- `exams`, `exam_candidates`, `exam_scores`, `exam_programs` - Kyu gradings (`docs/Q_EXAMS.md`)
- `training_plan_trainings`, `training_plan_sessions`, `training_plan_breaks` - The TK's training plan (`docs/TRAINING_PLAN.md`)
- `ai_imports` - Usage log and daily limits of the Daten-Assistent, no content (`docs/AI_ASSISTANT.md`)

**Views and Functions:**

- Views for statistics aggregation (`view_logs_summary`)
- Functions for generating checklists and leaderboards
- `user_profiles` with status (`pending` / `approved` / `disabled`) and role (`member` / `viewer` / `trainer` / `admin`); a trigger on `auth.users` creates and syncs the profile, admins approve new accounts under `/dashboard/users`; member accounts only get in while a member record is active or passive (`docs/MEMBER_SIGN_IN.md`)
- RLS helper functions `is_approved_user()` (staff, or a member account whose membership counts), `my_member_ids()`, `is_writer()`, `is_admin()` used by every table and storage policy

All SQL schemas, functions, and policies are version-controlled in the `supabase/migrations/` directory. The initial schema is in `20250814155759_remote_schema.sql`.

## Deployment

The application is configured for deployment on Netlify using `@sveltejs/adapter-netlify`.

1. Build the application:

```bash
npm run build
```

2. Deploy to Netlify (automatic via `netlify.toml` configuration)

3. Set environment variables in Netlify dashboard:
   - `PUBLIC_SUPABASE_DATABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY` (the project's publishable key, `sb_publishable_...`; the legacy JWT anon key stops working at the end of 2026)
   - `PUBLIC_MODE` (set to "PROD"). Only `DEV` builds offer the
     email/password test login, which works only where `seed.sql` created
     the test users (local and preview branches, see
     [docs/SUPABASE_BRANCHING.md](docs/SUPABASE_BRANCHING.md#seed-data-and-test-logins)).
     `DEMO` is only for the public demo at demo.adsumus.ch, a made-up club
     on its own Supabase project with one-click role logins and a demo banner
     (see [docs/DEMO.md](docs/DEMO.md)).

   Optionally, to override a club setting for a specific deploy context
   (production vs. deploy previews), add any of the `PUBLIC_CLUB_*` /
   `PUBLIC_TRIAL_*` / `PUBLIC_DEFAULT_LOCALE` variables listed in
   `.env.example`. Unset variables keep their defaults.

   For the Daten-Assistent add `PRIVATE_ANTHROPIC_API_KEY` (secret, not for
   Deploy Previews), see [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).

   For error monitoring add `PUBLIC_SENTRY_DSN` (and `SENTRY_AUTH_TOKEN`,
   `SENTRY_ORG`, `SENTRY_PROJECT` for readable stack traces), see
   [docs/ERROR_MONITORING.md](docs/ERROR_MONITORING.md).

   An external uptime monitor calls `/api/health` every 5 minutes, see
   [docs/UPTIME_MONITORING.md](docs/UPTIME_MONITORING.md).

   Security headers (Content Security Policy, who may embed the app in a
   frame) are described in [docs/SECURITY_HEADERS.md](docs/SECURITY_HEADERS.md).

### Preview branches and database deployments

Pull requests get an isolated Supabase preview branch (with migrations and
seed data applied) wired to the Netlify Deploy Preview. Merging to `main`
deploys migrations to the dev environment (main.admin.jacwohlen.ch);
promoting `main` into `prod` deploys them to production
(admin.jacwohlen.ch). Environments and workflow are documented in
[docs/SUPABASE_BRANCHING.md](docs/SUPABASE_BRANCHING.md).

## External Integrations

### Webling Sync

The `webling-sync/` directory contains the Webling sync: it reads members and events (with participant registrations) from the Webling API and writes them through the database's integration layer (`docs/INTEGRATIONS.md`). GitHub Actions runs it daily against prod (`.github/workflows/webling-sync.yml`).

**Local runs:**

1. Create a virtual environment and install dependencies
2. Configure the Webling and Supabase credentials in environment variables (and `ANONYMIZE` for members)
3. From `webling-sync/`, run `python src/sync.py members` or `python src/sync.py events` (`--dry-run` changes no members or events; it still logs its run, see `webling-sync/README.md`), or `python src/sync.py list` for the calendar ids

See `webling-sync/README.md` for detailed instructions.

## Contributing

Contributions are welcome! This project is designed to help martial arts clubs and similar organizations manage attendance more effectively.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and test thoroughly
4. Run linting and type checking (`npm run lint && npm run check`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Quality

- Follow the existing code style and conventions
- Add tests for new features
- Update documentation as needed
- Ensure all checks pass before submitting PR

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For questions, issues, or feature requests, please open an issue on GitHub.

## Acknowledgments

Built with SvelteKit, Supabase, and other excellent open-source tools.
