import { browser } from '$app/environment';
import { locale } from 'svelte-i18n';
import type { PublicLocale } from '$lib/clubConfigParser';

/**
 * Language chosen in the profile menu. Stored in a cookie (not
 * localStorage) so the server renders the page in that language as well,
 * instead of the request's Accept-Language.
 */
export const USER_LOCALE_COOKIE = 'locale';

const ONE_YEAR = 60 * 60 * 24 * 365;

export function parseUserLocale(value: string | null | undefined): PublicLocale | null {
  return value === 'de' || value === 'en' ? value : null;
}

export function readUserLocale(): PublicLocale | null {
  if (!browser) return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${USER_LOCALE_COOKIE}=([^;]*)`));
  return parseUserLocale(match?.[1]);
}

export function setUserLocale(next: PublicLocale) {
  locale.set(next);
  if (!browser) return;
  document.cookie = `${USER_LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}
