/**
 * Pure merging of admin-editable settings (rows of the `app_settings`
 * table) over their defaults.
 *
 * Like `clubConfigParser`, this module deliberately has no SvelteKit or
 * Supabase imports so it can be unit-tested as-is. The running app applies
 * the merge through `./appSettings`, which is the only place that fetches
 * the table.
 *
 * Values come from jsonb and are therefore untyped; every key is validated
 * individually and falls back to its default when missing or malformed, so
 * a bad row can never break the app.
 */

import type { ClubConfig, PublicLocale } from './clubConfigParser';

/** Tunables for how much the dashboard shows, as opposed to whose club it shows. */
export interface DisplayConfig {
  /** Sessions shown in the checklist attendance streak dots. */
  checklistStreakLength: number;
  /** Entries the member attendance log shows per "load more" step. */
  attendanceLogPageSize: number;
  /** Months of history in the member attendance heatmap. */
  attendanceGraphMonths: number;
  /** Entries in the recent-achievements list on the stats page. */
  recentAchievementsLimit: number;
  /** Seconds until the badge celebration overlay dismisses itself. */
  badgeCelebrationSeconds: number;
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  checklistStreakLength: 9,
  attendanceLogPageSize: 10,
  attendanceGraphMonths: 5,
  recentAchievementsLimit: 10,
  badgeCelebrationSeconds: 6
};

/** Raw `app_settings` rows: key → jsonb value. */
export type SettingValues = Record<string, unknown>;

export type SettingGroup = 'club' | 'trial' | 'display';
export type SettingKind = 'text' | 'list' | 'int' | 'locale';

export interface SettingField {
  /** Row key in `app_settings`. */
  key: string;
  /** i18n suffix: `page.settings.field.<id>.label` / `.description`. */
  id: string;
  group: SettingGroup;
  kind: SettingKind;
  /** Lower bound for `int` fields. */
  min?: number;
}

/** Every setting the admin settings page offers, in display order. */
export const SETTING_FIELDS: SettingField[] = [
  { key: 'club.name', id: 'clubName', group: 'club', kind: 'text' },
  { key: 'club.url', id: 'clubUrl', group: 'club', kind: 'text' },
  { key: 'club.logo', id: 'clubLogo', group: 'club', kind: 'text' },
  { key: 'club.contactEmail', id: 'clubContactEmail', group: 'club', kind: 'text' },
  { key: 'club.sections', id: 'clubSections', group: 'club', kind: 'list' },
  { key: 'locale.default', id: 'defaultLocale', group: 'club', kind: 'locale' },
  {
    key: 'trial.sessionThreshold',
    id: 'trialSessionThreshold',
    group: 'trial',
    kind: 'int',
    min: 1
  },
  {
    key: 'display.checklistStreakLength',
    id: 'checklistStreakLength',
    group: 'display',
    kind: 'int',
    min: 1
  },
  {
    key: 'display.attendanceLogPageSize',
    id: 'attendanceLogPageSize',
    group: 'display',
    kind: 'int',
    min: 1
  },
  {
    key: 'display.attendanceGraphMonths',
    id: 'attendanceGraphMonths',
    group: 'display',
    kind: 'int',
    min: 1
  },
  {
    key: 'display.recentAchievementsLimit',
    id: 'recentAchievementsLimit',
    group: 'display',
    kind: 'int',
    min: 1
  },
  {
    key: 'display.badgeCelebrationSeconds',
    id: 'badgeCelebrationSeconds',
    group: 'display',
    kind: 'int',
    min: 1
  }
];

function text(value: unknown, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : fallback;
}

function optionalText(value: unknown, fallback: string | null): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : fallback;
}

/** Non-empty array of non-blank strings. Anything else falls back. */
function list(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

/** Whole number of at least `min`. Anything else falls back. */
function positiveInt(value: unknown, fallback: number, min = 1): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fallback;
}

function publicLocale(value: unknown, fallback: PublicLocale): PublicLocale {
  return value === 'de' || value === 'en' ? value : fallback;
}

export function applyClubSettings(base: ClubConfig, values: SettingValues): ClubConfig {
  return {
    name: text(values['club.name'], base.name),
    url: text(values['club.url'], base.url),
    logo: text(values['club.logo'], base.logo),
    contactEmail: optionalText(values['club.contactEmail'], base.contactEmail),
    sections: list(values['club.sections'], base.sections),
    trialSessionThreshold: positiveInt(
      values['trial.sessionThreshold'],
      base.trialSessionThreshold
    ),
    defaultLocale: publicLocale(values['locale.default'], base.defaultLocale)
  };
}

export function applyDisplaySettings(base: DisplayConfig, values: SettingValues): DisplayConfig {
  return {
    checklistStreakLength: positiveInt(
      values['display.checklistStreakLength'],
      base.checklistStreakLength
    ),
    attendanceLogPageSize: positiveInt(
      values['display.attendanceLogPageSize'],
      base.attendanceLogPageSize
    ),
    attendanceGraphMonths: positiveInt(
      values['display.attendanceGraphMonths'],
      base.attendanceGraphMonths
    ),
    recentAchievementsLimit: positiveInt(
      values['display.recentAchievementsLimit'],
      base.recentAchievementsLimit
    ),
    badgeCelebrationSeconds: positiveInt(
      values['display.badgeCelebrationSeconds'],
      base.badgeCelebrationSeconds
    )
  };
}
