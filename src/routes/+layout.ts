import type { LayoutLoad } from './$types';
import { browser } from '$app/env';
import '#lib/i18n/index.ts';
import { get } from 'svelte/store';
import { locale, waitLocale } from 'svelte-i18n';
import { loadAppSettings } from '#lib/appSettings.ts';
import { readUserLocale } from '#lib/userLocale.ts';
import { applyDayjsLocale } from '#lib/dayjsLocale.ts';
import { setAppLocale } from '#lib/i18n/appLocale.ts';

export const load: LayoutLoad = async ({ data }) => {
  if (browser) {
    setAppLocale(readUserLocale() ?? window.navigator.language);
  }
  // Apply admin-configured settings before any page renders. Cached per
  // app session; failures fall back to the environment defaults.
  await Promise.all([loadAppSettings(), waitLocale()]);
  // Month and weekday names before the first page renders: pages format
  // dates in $derived values that the layout's $effect would only reach
  // after they were computed (a reloaded page showed "26. October 2026").
  if (browser) applyDayjsLocale(get(locale));
  return {
    session: data.session,
    userProfile: data.userProfile,
    access: data.access
  };
};
