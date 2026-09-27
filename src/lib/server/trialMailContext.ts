import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { parseClubConfig, type ClubConfig } from '$lib/clubConfigParser';
import { applyClubSettings, type SettingValues } from '$lib/appSettingsParser';

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
