import { env } from '$env/dynamic/public';
import { parseClubConfig } from './clubConfigParser';

/**
 * Club-specific settings for the running app: everything that describes
 * *which* club this deployment serves, as opposed to *how* the app is wired
 * up (Supabase URL, OAuth, PUBLIC_MODE — those stay in `$env/static/public`).
 *
 * Every value has a default and can be overridden per deploy context through
 * a `PUBLIC_CLUB_*` / `PUBLIC_TRIAL_*` / `PUBLIC_DEFAULT_LOCALE` variable (see
 * .env.example and README). They are read from `$env/dynamic/public` on
 * purpose: with `$env/static/public` a *missing* variable is a build error,
 * which is right for required infrastructure but wrong for optional settings.
 *
 * `$env/dynamic/public` is resolved from the SvelteKit runtime and is not
 * available in unit tests. Keep this module to the one line that reads it;
 * everything testable lives in `./clubConfigParser` — import from there in
 * tests, never from here.
 */
export const clubConfig = parseClubConfig(env);

export type { ClubConfig, PublicLocale } from './clubConfigParser';
