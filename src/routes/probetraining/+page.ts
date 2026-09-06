import type { PageLoad } from './$types';
import { locale, waitLocale } from 'svelte-i18n';
import { DEFAULT_PUBLIC_LOCALE, readStoredLocale } from '$lib/publicLocale';

export const load: PageLoad = async () => {
  locale.set(readStoredLocale() ?? DEFAULT_PUBLIC_LOCALE);
  await waitLocale();
};
