# Administra - Attendance Tracking System

A modern attendance tracking system designed specifically for martial arts clubs and training organizations. Built with SvelteKit and Supabase, Administra makes it easy to manage training sessions, track attendance, and generate insightful statistics.

## Features

- **Member Management** - Maintain a database of athletes and trainers with profile information and flexible labeling
- **Training Sessions** - Create and manage recurring training classes with metadata (title, schedule, section)
- **Attendance Tracking** - Quick and easy attendance marking for each training date
- **Statistics & Leaderboards** - View comprehensive attendance statistics, top athletes, and trainer activity by year and section
- **Secure Authentication** - Google OAuth integration with domain-restricted access
- **Multi-language Support** - Built-in internationalization (German/English)
- **Responsive Design** - Works seamlessly across desktop and mobile devices

## Tech Stack

- **Frontend**: SvelteKit with TypeScript
- **Styling**: Tailwind CSS + Skeleton UI
- **Backend**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth with Google OAuth
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
PUBLIC_SUPABASE_URL="your-supabase-project-url"
PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"
PUBLIC_MODE="DEV"  # Use "PROD" for production
```

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

### Project Structure

```
src/
├── lib/
│   ├── i18n/          # Internationalization files
│   ├── models.ts      # TypeScript type definitions
│   └── supabase.ts    # Supabase client configuration
├── routes/
│   ├── dashboard/     # Main application routes
│   │   ├── members/   # Member management
│   │   ├── trainings/ # Training session management
│   │   └── stats/     # Statistics and reports
│   └── +layout.svelte # Root layout with auth
└── tests/             # Unit tests

webling-sync/          # External member sync tool
```

## Database Setup

The application requires a Supabase PostgreSQL database with specific tables, views, functions, and security policies.

### Prerequisites

- Supabase CLI installed (`npm install -g supabase`)
- Supabase project created

### Setup Database

The database schema is managed through migrations located in the `supabase/migrations/` directory. To set up the database:

1. **Link to your Supabase project:**
```bash
supabase link --project-ref your-project-ref
```

2. **Apply all migrations:**
```bash
supabase db push
```

3. **Or reset and apply migrations locally (for development):**
```bash
supabase db reset
```

### Database Structure

**Core Tables:**
- `members` - Athletes and trainers with profile information
- `trainings` - Training session definitions and schedules
- `participants` - Member enrollment in training sessions
- `logs` - Attendance records with date and trainer status
- `events` - General events and activities

**Views and Functions:**
- Views for statistics aggregation (`view_logs_summary`)
- Functions for generating checklists and leaderboards
- Domain-restricted authentication trigger for `@jacwohlen.ch` emails

All SQL schemas, functions, and policies are version-controlled in the `supabase/migrations/` directory. The initial schema is in `20250814155759_remote_schema.sql`.

## Deployment

The application is configured for deployment on Netlify using `@sveltejs/adapter-netlify`.

1. Build the application:
```bash
npm run build
```

2. Deploy to Netlify (automatic via `netlify.toml` configuration)

3. Set environment variables in Netlify dashboard:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
   - `PUBLIC_MODE` (set to "PROD")

## External Integrations

### Webling Sync

The `webling-sync/` directory contains a Python script for synchronizing member data from the Webling API.

**Setup:**
1. Create a virtual environment and install dependencies
2. Configure Webling API credentials in environment variables
3. Run `python webling.py` to sync member data

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
