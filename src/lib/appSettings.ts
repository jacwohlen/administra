import { supabaseClient } from './supabase';
import { clubConfig } from './clubConfig';
import {
  applyClubSettings,
  applyDisplaySettings,
  DEFAULT_DISPLAY_CONFIG,
  type DisplayConfig,
  type SettingValues
} from './appSettingsParser';

/**
 * Runtime settings, resolved as: `app_settings` table rows over environment
 * variables over built-in defaults. Admins edit the table rows from
 * /dashboard/settings; a missing row keeps the environment/built-in value,
 * so deployments configured purely through env vars keep working unchanged.
 *
 * `loadAppSettings()` is called from the root layout load before any page
 * renders and mutates `clubConfig` / `displayConfig` in place, so existing
 * consumers keep importing those objects and reading plain properties.
 * Fetched once per app session like `referenceData`; a failed fetch is not
 * cached, so the next navigation retries, and until then the defaults
 * apply — the settings layer can never take the app down.
 */

/** The env-effective baseline, captured before any database override. */
const envClubConfig = { ...clubConfig, sections: [...clubConfig.sections] };

export const displayConfig: DisplayConfig = { ...DEFAULT_DISPLAY_CONFIG };

/** Defaults per setting key, for placeholders on the settings page. */
export function getSettingDefaults(): SettingValues {
  return {
    'club.name': envClubConfig.name,
    'club.url': envClubConfig.url,
    'club.logo': envClubConfig.logo,
    'club.contactEmail': envClubConfig.contactEmail,
    'club.sections': envClubConfig.sections,
    'locale.default': envClubConfig.defaultLocale,
    'trial.sessionThreshold': envClubConfig.trialSessionThreshold,
    'display.checklistStreakLength': DEFAULT_DISPLAY_CONFIG.checklistStreakLength,
    'display.attendanceLogPageSize': DEFAULT_DISPLAY_CONFIG.attendanceLogPageSize,
    'display.attendanceGraphMonths': DEFAULT_DISPLAY_CONFIG.attendanceGraphMonths,
    'display.recentAchievementsLimit': DEFAULT_DISPLAY_CONFIG.recentAchievementsLimit,
    'display.badgeCelebrationSeconds': DEFAULT_DISPLAY_CONFIG.badgeCelebrationSeconds
  };
}

let loaded = false;

export async function loadAppSettings(): Promise<void> {
  if (loaded) return;
  const { data, error } = await supabaseClient.from('app_settings').select('key, value');
  if (error || !Array.isArray(data)) return;
  const values: SettingValues = Object.fromEntries(data.map((row) => [row.key, row.value]));
  Object.assign(clubConfig, applyClubSettings(envClubConfig, values));
  Object.assign(displayConfig, applyDisplaySettings(DEFAULT_DISPLAY_CONFIG, values));
  loaded = true;
}

/** Call after editing `app_settings` so the next load refetches. */
export function invalidateAppSettings(): void {
  loaded = false;
}
