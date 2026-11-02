import type { PageLoad } from './$types';
import { waitLocale } from 'svelte-i18n';
import { defaultPublicLocale, readStoredLocale } from '#lib/publicLocale.ts';
import { loadAppSettings } from '#lib/appSettings.ts';
import { setAppLocale } from '#lib/i18n/appLocale.ts';

export const load: PageLoad = async () => {
  // Page loads run concurrently with the root layout load, so make sure any
  // admin-configured default locale is applied before picking the language.
  await loadAppSettings();
  setAppLocale(readStoredLocale() ?? defaultPublicLocale());
  await waitLocale();
};
