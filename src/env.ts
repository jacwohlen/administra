import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Every environment variable the app reads (SvelteKit 3 only exposes the ones
 * declared here, through `$app/env/public` and `$app/env/private`). See
 * .env.example for what each one does.
 *
 * - The Supabase connection and PUBLIC_MODE are required and inlined at build
 *   time (`static`): a build without them fails, as with `$env/static/public`.
 * - Everything else is optional and read when the app starts, so a deploy
 *   without it still builds (club settings fall back to their defaults, mails,
 *   the assistant and Sentry stay off).
 */
const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
  PUBLIC_SUPABASE_DATABASE_URL: { public: true, static: true },
  PUBLIC_SUPABASE_ANON_KEY: { public: true, static: true },
  PUBLIC_MODE: { public: true, static: true },

  // Error monitoring (docs/ERROR_MONITORING.md)
  PUBLIC_SENTRY_DSN: { public: true, schema: optional },
  PUBLIC_SENTRY_TRACES_SAMPLE_RATE: { public: true, schema: optional },

  // Club settings, defaults in src/lib/clubConfigParser.ts
  PUBLIC_CLUB_NAME: { public: true, schema: optional },
  PUBLIC_CLUB_URL: { public: true, schema: optional },
  PUBLIC_CLUB_LOGO: { public: true, schema: optional },
  PUBLIC_CLUB_CONTACT_EMAIL: { public: true, schema: optional },
  PUBLIC_CLUB_SECTIONS: { public: true, schema: optional },
  PUBLIC_TRIAL_SESSION_THRESHOLD: { public: true, schema: optional },
  PUBLIC_TRIAL_INACTIVE_DAYS: { public: true, schema: optional },
  PUBLIC_DEFAULT_LOCALE: { public: true, schema: optional },

  // Trial e-mails (docs/TRIAL_EMAILS.md)
  PRIVATE_SMTP_HOST: { schema: optional },
  PRIVATE_SMTP_PORT: { schema: optional },
  PRIVATE_SMTP_USER: { schema: optional },
  PRIVATE_SMTP_PASSWORD: { schema: optional },
  PRIVATE_SMTP_FROM: { schema: optional },

  // Daten-Assistent (docs/AI_ASSISTANT.md)
  PRIVATE_ANTHROPIC_API_KEY: { schema: optional },
  PRIVATE_ASSISTANT_MODEL: { schema: optional },
  PRIVATE_ASSISTANT_EFFORT: { schema: optional },
  PRIVATE_ASSISTANT_TIMEOUT_MS: { schema: optional }
});
