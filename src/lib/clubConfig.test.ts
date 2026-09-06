import { describe, it, expect } from 'vitest';
import { parseClubConfig, DEFAULT_CLUB_CONFIG } from './clubConfigParser';

describe('parseClubConfig', () => {
  it('returns the defaults when nothing is set', () => {
    expect(parseClubConfig({})).toEqual(DEFAULT_CLUB_CONFIG);
  });

  it('ignores unrelated variables', () => {
    expect(parseClubConfig({ PUBLIC_MODE: 'DEV', SOMETHING: 'x' })).toEqual(DEFAULT_CLUB_CONFIG);
  });

  describe('text values', () => {
    it('take the configured value, trimmed', () => {
      const c = parseClubConfig({
        PUBLIC_CLUB_NAME: '  Judo Club Test  ',
        PUBLIC_CLUB_URL: 'https://example.org',
        PUBLIC_CLUB_LOGO: '/logo.png'
      });
      expect(c.name).toBe('Judo Club Test');
      expect(c.url).toBe('https://example.org');
      expect(c.logo).toBe('/logo.png');
    });

    it('fall back when blank', () => {
      const c = parseClubConfig({ PUBLIC_CLUB_NAME: '   ', PUBLIC_CLUB_URL: '' });
      expect(c.name).toBe(DEFAULT_CLUB_CONFIG.name);
      expect(c.url).toBe(DEFAULT_CLUB_CONFIG.url);
    });
  });

  describe('contactEmail', () => {
    it('is null by default and when blank', () => {
      expect(parseClubConfig({}).contactEmail).toBeNull();
      expect(parseClubConfig({ PUBLIC_CLUB_CONTACT_EMAIL: '  ' }).contactEmail).toBeNull();
    });

    it('takes the configured address', () => {
      expect(parseClubConfig({ PUBLIC_CLUB_CONTACT_EMAIL: 'info@example.org' }).contactEmail).toBe(
        'info@example.org'
      );
    });
  });

  describe('sections', () => {
    it('splits a comma-separated list and trims each entry', () => {
      expect(parseClubConfig({ PUBLIC_CLUB_SECTIONS: 'Judo, Aikido ,Karate' }).sections).toEqual([
        'Judo',
        'Aikido',
        'Karate'
      ]);
    });

    it('drops empty entries', () => {
      expect(parseClubConfig({ PUBLIC_CLUB_SECTIONS: 'Judo,,Aikido,' }).sections).toEqual([
        'Judo',
        'Aikido'
      ]);
    });

    it('falls back rather than producing an empty list', () => {
      expect(parseClubConfig({ PUBLIC_CLUB_SECTIONS: '' }).sections).toEqual(
        DEFAULT_CLUB_CONFIG.sections
      );
      expect(parseClubConfig({ PUBLIC_CLUB_SECTIONS: ' , , ' }).sections).toEqual(
        DEFAULT_CLUB_CONFIG.sections
      );
    });
  });

  describe('trialSessionThreshold', () => {
    it('accepts a positive whole number', () => {
      expect(parseClubConfig({ PUBLIC_TRIAL_SESSION_THRESHOLD: '5' }).trialSessionThreshold).toBe(
        5
      );
      expect(parseClubConfig({ PUBLIC_TRIAL_SESSION_THRESHOLD: '1' }).trialSessionThreshold).toBe(
        1
      );
    });

    it.each(['0', '-1', '2.5', 'abc', '', '  '])('falls back for %j', (value) => {
      expect(parseClubConfig({ PUBLIC_TRIAL_SESSION_THRESHOLD: value }).trialSessionThreshold).toBe(
        DEFAULT_CLUB_CONFIG.trialSessionThreshold
      );
    });
  });

  describe('defaultLocale', () => {
    it('accepts de and en, case-insensitively', () => {
      expect(parseClubConfig({ PUBLIC_DEFAULT_LOCALE: 'en' }).defaultLocale).toBe('en');
      expect(parseClubConfig({ PUBLIC_DEFAULT_LOCALE: 'DE' }).defaultLocale).toBe('de');
    });

    it('falls back for unsupported or blank values', () => {
      expect(parseClubConfig({ PUBLIC_DEFAULT_LOCALE: 'fr' }).defaultLocale).toBe(
        DEFAULT_CLUB_CONFIG.defaultLocale
      );
      expect(parseClubConfig({ PUBLIC_DEFAULT_LOCALE: '' }).defaultLocale).toBe(
        DEFAULT_CLUB_CONFIG.defaultLocale
      );
    });
  });

  it('lets callers supply their own defaults', () => {
    const custom = { ...DEFAULT_CLUB_CONFIG, name: 'Other Club', sections: ['Karate'] };
    const c = parseClubConfig({}, custom);
    expect(c.name).toBe('Other Club');
    expect(c.sections).toEqual(['Karate']);
  });
});
