/**
 * Pure parsing of club-specific settings from raw environment values.
 *
 * This module deliberately has no SvelteKit imports so it can be unit-tested
 * as-is. The running app gets its parsed `clubConfig` from `./clubConfig`,
 * which is the only place that touches `$env/dynamic/public`.
 */

export type PublicLocale = 'de' | 'en';

export interface ClubConfig {
  /** Display name of the club, shown on public-facing pages. */
  name: string;
  /** The club's public website, linked from public-facing pages. */
  url: string;
  /** Path under `static/` (or an absolute URL) of the club logo. */
  logo: string;
  /** Public address for enquiries; `null` when the club does not publish one. */
  contactEmail: string | null;
  /** Sections a training, event or trial candidate can belong to. */
  sections: string[];
  /** Trial sessions after which a candidate is flagged to become a member. */
  trialSessionThreshold: number;
  /** Language of public-facing pages unless the visitor picks another. */
  defaultLocale: PublicLocale;
}

export const DEFAULT_CLUB_CONFIG: ClubConfig = {
  name: 'JAC Wohlen',
  url: 'https://jacwohlen.ch',
  logo: '/club-logo.svg',
  contactEmail: null,
  sections: ['Judo', 'Aikido'],
  trialSessionThreshold: 3,
  defaultLocale: 'de'
};

export type RawClubEnv = Record<string, string | undefined>;

function text(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return value ? value : fallback;
}

function optionalText(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

/** Comma-separated list. An empty or blank value falls back rather than yielding no sections. */
function list(raw: string | undefined, fallback: string[]): string[] {
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

/** Whole number of at least 1. Anything else falls back. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

function publicLocale(raw: string | undefined, fallback: PublicLocale): PublicLocale {
  const value = raw?.trim().toLowerCase();
  return value === 'de' || value === 'en' ? value : fallback;
}

export function parseClubConfig(
  raw: RawClubEnv,
  defaults: ClubConfig = DEFAULT_CLUB_CONFIG
): ClubConfig {
  return {
    name: text(raw.PUBLIC_CLUB_NAME, defaults.name),
    url: text(raw.PUBLIC_CLUB_URL, defaults.url),
    logo: text(raw.PUBLIC_CLUB_LOGO, defaults.logo),
    contactEmail: optionalText(raw.PUBLIC_CLUB_CONTACT_EMAIL) ?? defaults.contactEmail,
    sections: list(raw.PUBLIC_CLUB_SECTIONS, defaults.sections),
    trialSessionThreshold: positiveInt(
      raw.PUBLIC_TRIAL_SESSION_THRESHOLD,
      defaults.trialSessionThreshold
    ),
    defaultLocale: publicLocale(raw.PUBLIC_DEFAULT_LOCALE, defaults.defaultLocale)
  };
}
