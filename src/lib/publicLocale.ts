import { browser } from '$app/environment';
import { locale } from 'svelte-i18n';
import { clubConfig } from '$lib/clubConfig';
import type { PublicLocale } from '$lib/clubConfigParser';

export type { PublicLocale };

/**
 * Language handling for the public trial registration form.
 *
 * Unlike the dashboard — which follows the browser language — the public form
 * is aimed at local prospective members and defaults to the club's configured
 * language (PUBLIC_DEFAULT_LOCALE). A visitor's explicit choice from the
 * language switcher is remembered and wins.
 */
const STORAGE_KEY = 'trial-registration-locale';

export const DEFAULT_PUBLIC_LOCALE: PublicLocale = clubConfig.defaultLocale;

export function readStoredLocale(): PublicLocale | null {
  if (!browser) return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'de' || stored === 'en' ? stored : null;
  } catch {
    // Storage can be unavailable (private mode).
    return null;
  }
}

export function setPublicLocale(next: PublicLocale) {
  locale.set(next);
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable; the choice just won't persist.
  }
}
