import { init } from 'svelte-i18n';

/**
 * The language whose messages fill in a missing one: German for every de-*
 * locale, English for all others. svelte-i18n loads the fallback's file along
 * with the locale's before a page renders; as the same language, a German
 * browser loads only de.json instead of de.json and en.json (about 30 KB
 * gzipped less, docs/PERFORMANCE.md). Nothing is ever missing: both files
 * have the same keys (i18n.test.ts).
 */
export function fallbackLocaleFor(lang: string | null | undefined): 'de' | 'en' {
  return lang?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/**
 * Switches the app's language, like `locale.set()`, and its fallback with it
 * (svelte-i18n's `init` may be called again: it only updates the options and
 * sets the locale). The locale itself stays as given, de-CH formats numbers
 * the Swiss way.
 */
export function setAppLocale(lang: string): Promise<void> | void {
  return init({ fallbackLocale: fallbackLocaleFor(lang), initialLocale: lang });
}
