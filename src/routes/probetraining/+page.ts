import type { PageLoad } from './$types';
import { locale, waitLocale } from 'svelte-i18n';
import { defaultPublicLocale, readStoredLocale } from '$lib/publicLocale';
import { loadAppSettings } from '$lib/appSettings';

export const load: PageLoad = async () => {
  // Page loads run concurrently with the root layout load, so make sure any
  // admin-configured default locale is applied before picking the language.
  await loadAppSettings();
  locale.set(readStoredLocale() ?? defaultPublicLocale());
  await waitLocale();
};
