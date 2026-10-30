import dayjs from 'dayjs';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDayjsLocale, dayjsLocaleFor } from './dayjsLocale';

describe('dayjsLocaleFor', () => {
  it('maps every German variant to de and everything else to en', () => {
    expect(dayjsLocaleFor('de')).toBe('de');
    expect(dayjsLocaleFor('de-CH')).toBe('de');
    expect(dayjsLocaleFor('DE-de')).toBe('de');
    expect(dayjsLocaleFor('en-GB')).toBe('en');
    expect(dayjsLocaleFor('fr-CH')).toBe('en');
    expect(dayjsLocaleFor(null)).toBe('en');
  });
});

describe('applyDayjsLocale', () => {
  afterEach(() => {
    dayjs.locale('en');
  });

  it('formats month names in German for a Swiss browser', () => {
    applyDayjsLocale('de-CH');
    expect(dayjs('2026-10-26').format('DD. MMMM YYYY')).toBe('26. Oktober 2026');
  });
});
