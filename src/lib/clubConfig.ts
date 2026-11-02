import * as env from '$app/env/public';
import { parseClubConfig } from './clubConfigParser';

/**
 * Club-specific settings for the running app: everything that describes
 * *which* club this deployment serves, as opposed to *how* the app is wired
 * up (Supabase URL, OAuth, PUBLIC_MODE — those are required and static in
 * src/env.ts).
 *
 * Every value has a default and can be overridden per deploy context through
 * a `PUBLIC_CLUB_*` / `PUBLIC_TRIAL_*` / `PUBLIC_DEFAULT_LOCALE` variable (see
 * .env.example and README). src/env.ts declares them optional and read at
 * runtime on purpose: a *missing* required variable is a build error, which
 * is right for infrastructure but wrong for optional settings.
 *
 * `$app/env/public` is resolved from the SvelteKit runtime and is not
 * available in unit tests. Keep this module to the one line that reads it;
 * everything testable lives in `./clubConfigParser` — import from there in
 * tests, never from here.
 *
 * Admins can additionally override every value at runtime from
 * /dashboard/settings: `./appSettings` fetches the `app_settings` table in
 * the root layout load and mutates this object in place, so always read
 * properties off `clubConfig` when needed instead of copying them at
 * import time.
 */
export const clubConfig = parseClubConfig(env);

export type { ClubConfig, PublicLocale } from './clubConfigParser';
