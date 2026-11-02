import { browser } from '$app/env';
import { init, register } from 'svelte-i18n';
import { readUserLocale } from '#lib/userLocale.ts';
import { fallbackLocaleFor } from './appLocale';

const defaultLocale = 'en';
export const initialLocale = browser
  ? (readUserLocale() ?? window.navigator.language)
  : defaultLocale;

register('en', () => import('./locales/en.json'));
register('de', () => import('./locales/de.json'));

init({
  // German for a German locale: only one file to load (appLocale.ts)
  fallbackLocale: fallbackLocaleFor(initialLocale),
  initialLocale: initialLocale
});
