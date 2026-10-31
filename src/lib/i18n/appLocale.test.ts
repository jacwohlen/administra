import { describe, expect, it } from 'vitest';
import { fallbackLocaleFor } from './appLocale';

describe('fallbackLocaleFor', () => {
  it('falls back to German for German locales, else English', () => {
    expect(fallbackLocaleFor('de')).toBe('de');
    expect(fallbackLocaleFor('de-CH')).toBe('de');
    expect(fallbackLocaleFor('DE-de')).toBe('de');
    expect(fallbackLocaleFor('en-GB')).toBe('en');
    expect(fallbackLocaleFor('fr-CH')).toBe('en');
    expect(fallbackLocaleFor(undefined)).toBe('en');
  });
});
