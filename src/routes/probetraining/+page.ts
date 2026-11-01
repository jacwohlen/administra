import type { PageLoad } from './$types';
import { waitLocale } from 'svelte-i18n';
import { defaultPublicLocale, readStoredLocale } from '$lib/publicLocale';
import { loadAppSettings } from '$lib/appSettings';
import { setAppLocale } from '$lib/i18n/appLocale';

export const load: PageLoad = async () => {
  // Page loads run concurrently with the root layout load, so make sure any
  // admin-configured default locale is applied before picking the language.
  await loadAppSettings();
  setAppLocale(readStoredLocale() ?? defaultPublicLocale());
  await waitLocale();
};
