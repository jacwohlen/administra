import type { PageLoad } from './$types';
import { waitLocale } from 'svelte-i18n';
import { supabaseClient } from '#lib/supabase.ts';
import { defaultPublicLocale, readStoredLocale } from '#lib/publicLocale.ts';
import { loadAppSettings } from '#lib/appSettings.ts';
import { setAppLocale } from '#lib/i18n/appLocale.ts';

export interface TrialStatusView {
  firstname: string;
  status: 'new' | 'waitlist' | 'assigned' | 'cancelled' | 'member';
  selfCancelled: boolean;
  section: string | null;
  locale: 'de' | 'en' | null;
  registeredAt: string | null;
  statusChangedAt: string | null;
  trainings: {
    title: string;
    weekday: string;
    dateFrom: string;
    dateTo: string;
    section: string;
    startDate: string | null;
  }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageLoad = async ({ params, depends }) => {
  depends('probetraining:status');
  await loadAppSettings();

  let status: TrialStatusView | null = null;
  if (UUID.test(params.token)) {
    const { data } = await supabaseClient.rpc('get_trial_status', { p_token: params.token });
    status = (data as TrialStatusView | null) ?? null;
  }

  // The visitor's own choice wins, then the language they registered in.
  setAppLocale(readStoredLocale() ?? status?.locale ?? defaultPublicLocale());
  await waitLocale();

  return { token: params.token, status };
};
