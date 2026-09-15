import { describe, it, expect } from 'vitest';
import { DEFAULT_CLUB_CONFIG } from './clubConfigParser';
import {
  applyClubSettings,
  applyDisplaySettings,
  DEFAULT_DISPLAY_CONFIG,
  SETTING_FIELDS
} from './appSettingsParser';

describe('applyClubSettings', () => {
  it('returns the base config when no rows exist', () => {
    expect(applyClubSettings(DEFAULT_CLUB_CONFIG, {})).toEqual(DEFAULT_CLUB_CONFIG);
  });

  it('ignores unknown keys', () => {
    expect(applyClubSettings(DEFAULT_CLUB_CONFIG, { 'club.somethingElse': 'x' })).toEqual(
      DEFAULT_CLUB_CONFIG
    );
  });

  it('applies overrides, trimmed', () => {
    const c = applyClubSettings(DEFAULT_CLUB_CONFIG, {
      'club.name': '  Judo Club Test  ',
      'club.url': 'https://example.org',
      'club.logo': '/logo.png',
      'club.contactEmail': 'info@example.org',
      'club.sections': ['Judo', ' Karate '],
      'trial.sessionThreshold': 5,
      'locale.default': 'en'
    });
    expect(c).toEqual({
      name: 'Judo Club Test',
      url: 'https://example.org',
      logo: '/logo.png',
      contactEmail: 'info@example.org',
      sections: ['Judo', 'Karate'],
      trialSessionThreshold: 5,
      defaultLocale: 'en'
    });
  });

  it.each([42, '', '   ', null, ['x']])('falls back for text value %j', (value) => {
    expect(applyClubSettings(DEFAULT_CLUB_CONFIG, { 'club.name': value }).name).toBe(
      DEFAULT_CLUB_CONFIG.name
    );
  });

  it('keeps contactEmail from the base when the row is blank or malformed', () => {
    const base = { ...DEFAULT_CLUB_CONFIG, contactEmail: 'env@example.org' };
    expect(applyClubSettings(base, { 'club.contactEmail': '  ' }).contactEmail).toBe(
      'env@example.org'
    );
    expect(applyClubSettings(base, { 'club.contactEmail': 7 }).contactEmail).toBe(
      'env@example.org'
    );
  });

  describe('sections', () => {
    it.each(['Judo', 42, [], ['  ', ''], [1, 2], null])('falls back for %j', (value) => {
      expect(applyClubSettings(DEFAULT_CLUB_CONFIG, { 'club.sections': value }).sections).toEqual(
        DEFAULT_CLUB_CONFIG.sections
      );
    });

    it('drops blank and non-string entries but keeps the rest', () => {
      expect(
        applyClubSettings(DEFAULT_CLUB_CONFIG, { 'club.sections': ['Judo', '', 3, 'Karate'] })
          .sections
      ).toEqual(['Judo', 'Karate']);
    });
  });

  it.each([0, -1, 2.5, '3', null])('falls back for trial threshold %j', (value) => {
    expect(
      applyClubSettings(DEFAULT_CLUB_CONFIG, { 'trial.sessionThreshold': value })
        .trialSessionThreshold
    ).toBe(DEFAULT_CLUB_CONFIG.trialSessionThreshold);
  });

  it.each(['fr', 'DE', '', 1])('falls back for locale %j', (value) => {
    expect(applyClubSettings(DEFAULT_CLUB_CONFIG, { 'locale.default': value }).defaultLocale).toBe(
      DEFAULT_CLUB_CONFIG.defaultLocale
    );
  });
});

describe('applyDisplaySettings', () => {
  it('returns the base config when no rows exist', () => {
    expect(applyDisplaySettings(DEFAULT_DISPLAY_CONFIG, {})).toEqual(DEFAULT_DISPLAY_CONFIG);
  });

  it('applies every override', () => {
    expect(
      applyDisplaySettings(DEFAULT_DISPLAY_CONFIG, {
        'display.checklistStreakLength': 12,
        'display.attendanceLogPageSize': 25,
        'display.attendanceGraphMonths': 8,
        'display.recentAchievementsLimit': 5,
        'display.badgeCelebrationSeconds': 10
      })
    ).toEqual({
      checklistStreakLength: 12,
      attendanceLogPageSize: 25,
      attendanceGraphMonths: 8,
      recentAchievementsLimit: 5,
      badgeCelebrationSeconds: 10
    });
  });

  it.each([0, -3, 1.5, '4', null])('falls back for %j', (value) => {
    expect(
      applyDisplaySettings(DEFAULT_DISPLAY_CONFIG, { 'display.checklistStreakLength': value })
        .checklistStreakLength
    ).toBe(DEFAULT_DISPLAY_CONFIG.checklistStreakLength);
  });
});

describe('SETTING_FIELDS', () => {
  it('has unique keys and ids', () => {
    const keys = SETTING_FIELDS.map((f) => f.key);
    const ids = SETTING_FIELDS.map((f) => f.id);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every field is picked up by one of the appliers', () => {
    // A field the settings page offers but the appliers ignore would be
    // silently dead: assert each key changes the merged result.
    const sample: Record<string, unknown> = {
      'club.name': 'X',
      'club.url': 'https://x.example',
      'club.logo': '/x.png',
      'club.contactEmail': 'x@example.org',
      'club.sections': ['X'],
      'locale.default': DEFAULT_CLUB_CONFIG.defaultLocale === 'de' ? 'en' : 'de',
      'trial.sessionThreshold': 99,
      'display.checklistStreakLength': 99,
      'display.attendanceLogPageSize': 99,
      'display.attendanceGraphMonths': 99,
      'display.recentAchievementsLimit': 99,
      'display.badgeCelebrationSeconds': 99
    };
    for (const field of SETTING_FIELDS) {
      expect(sample, `missing sample for ${field.key}`).toHaveProperty(field.key);
      const club = applyClubSettings(DEFAULT_CLUB_CONFIG, { [field.key]: sample[field.key] });
      const display = applyDisplaySettings(DEFAULT_DISPLAY_CONFIG, {
        [field.key]: sample[field.key]
      });
      const changed =
        JSON.stringify(club) !== JSON.stringify(DEFAULT_CLUB_CONFIG) ||
        JSON.stringify(display) !== JSON.stringify(DEFAULT_DISPLAY_CONFIG);
      expect(changed, `${field.key} is ignored by both appliers`).toBe(true);
    }
  });
});
