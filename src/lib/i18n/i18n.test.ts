import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import de from './locales/de.json';

/**
 * Recursively collects all leaf key paths from a nested object.
 * E.g. { a: { b: "x", c: "y" } } => ["a.b", "a.c"]
 * Arrays are treated as leaf values (not recursed into).
 */
function getKeyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...getKeyPaths(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

describe('i18n locale parity', () => {
  const enKeys = getKeyPaths(en);
  const deKeys = getKeyPaths(de);

  it('English and German have the same number of keys', () => {
    expect(enKeys.length).toBe(deKeys.length);
  });

  it('English and German have identical key sets', () => {
    const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
    const missingInEn = deKeys.filter((k) => !enKeys.includes(k));

    expect(missingInDe).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it('no locale has empty string values', () => {
    function checkNoEmpty(obj: Record<string, unknown>, locale: string, prefix = '') {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          checkNoEmpty(value as Record<string, unknown>, locale, path);
        } else if (typeof value === 'string') {
          expect(value.trim().length, `${locale}:${path} is empty`).toBeGreaterThan(0);
        }
      }
    }

    checkNoEmpty(en, 'en');
    checkNoEmpty(de, 'de');
  });
});
