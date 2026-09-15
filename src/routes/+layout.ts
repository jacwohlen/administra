import type { LayoutLoad } from './$types';
import { browser } from '$app/environment';
import '$lib/i18n';
import { locale, waitLocale } from 'svelte-i18n';
import { loadAppSettings } from '$lib/appSettings';

export const load: LayoutLoad = async ({ data }) => {
  if (browser) {
    locale.set(window.navigator.language);
  }
  // Apply admin-configured settings before any page renders. Cached per
  // app session; failures fall back to the environment defaults.
  await Promise.all([loadAppSettings(), waitLocale()]);
  return {
    session: data.session,
    userProfile: data.userProfile
  };
};
