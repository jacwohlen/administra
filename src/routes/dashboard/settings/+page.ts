import { error, redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { getSettingDefaults, loadAppSettings } from '$lib/appSettings';
import type { SettingValues } from '$lib/appSettingsParser';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { userProfile } = await parent();
  if (!userProfile || userProfile.role !== 'admin') {
    redirect(303, '/dashboard');
  }

  await loadAppSettings();
  const { data, error: fetchError } = await supabaseClient
    .from('app_settings')
    .select('key, value');
  if (fetchError) {
    error(500, fetchError.message);
  }

  return {
    overrides: Object.fromEntries((data ?? []).map((row) => [row.key, row.value])) as SettingValues,
    defaults: getSettingDefaults()
  };
};
