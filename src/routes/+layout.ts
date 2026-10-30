import type { LayoutLoad } from './$types';
import { browser } from '$app/environment';
import '$lib/i18n';
import { get } from 'svelte/store';
import { locale, waitLocale } from 'svelte-i18n';
import { loadAppSettings } from '$lib/appSettings';
import { readUserLocale } from '$lib/userLocale';
import { applyDayjsLocale } from '$lib/dayjsLocale';

export const load: LayoutLoad = async ({ data }) => {
  if (browser) {
    locale.set(readUserLocale() ?? window.navigator.language);
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
