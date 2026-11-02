import type { SupabaseClient } from '@supabase/supabase-js';
import * as env from '$app/env/public';
import { parseClubConfig, type ClubConfig } from '#lib/clubConfigParser.ts';
import { applyClubSettings, type SettingValues } from '#lib/appSettingsParser.ts';

/**
 * Club settings and raw `app_settings` rows for rendering a mail on the
 * server. Computed per request rather than through the shared `clubConfig`
 * object, which the client-side settings loader mutates in place.
 */
export async function loadMailSettings(
  supabase: SupabaseClient
): Promise<{ club: ClubConfig; values: SettingValues }> {
  const { data } = await supabase.from('app_settings').select('key, value');
  const values: SettingValues = Object.fromEntries(
    (data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value])
  );
  return { club: applyClubSettings(parseClubConfig(env), values), values };
}
