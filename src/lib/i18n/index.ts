import { browser } from '$app/env';
import { init, register } from 'svelte-i18n';
import { readUserLocale } from '#lib/userLocale.ts';
import { brandForHost, brandMessages } from '#lib/brand.ts';
import { fallbackLocaleFor } from './appLocale';

const defaultLocale = 'en';
export const initialLocale = browser
  ? (readUserLocale() ?? window.navigator.language)
  : defaultLocale;

// The product's name by host (#lib/brand.ts). The server keeps the default
// name in its messages, shared by every request, and hooks.server.ts puts the
// host's name into the rendered page instead.
const brand = browser ? brandForHost(window.location.hostname) : undefined;
const branded = <T>(messages: { default: T }) =>
  brand ? brandMessages(messages.default, brand) : messages.default;

register('en', () => import('./locales/en.json').then(branded));
register('de', () => import('./locales/de.json').then(branded));

init({
  // German for a German locale: only one file to load (appLocale.ts)
  fallbackLocale: fallbackLocaleFor(initialLocale),
  initialLocale: initialLocale
});
