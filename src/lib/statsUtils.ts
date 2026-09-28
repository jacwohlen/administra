import type { Athletes } from '$lib/models';

/**
 * Groups an array of Athletes by their section, sorted alphabetically by section name.
 */
export function groupBySection(data: Athletes[]): { [key: string]: Athletes[] } {
  const grouped = data.reduce((acc: { [key: string]: Athletes[] }, item: Athletes) => {
    if (!acc[item.section]) {
      acc[item.section] = [];
    }
    acc[item.section].push(item);
    return acc;
  }, {});

  return Object.keys(grouped)
    .sort()
    .reduce((sorted: { [key: string]: Athletes[] }, key: string) => {
      sorted[key] = grouped[key];
      return sorted;
    }, {});
}

/**
 * Resolves year parameter from route params into a numeric year and mode.
 */
export function resolveYearParam(yearParam: string | undefined): {
  year: number;
  yearmode: 'ALL' | 'YEAR';
} {
  if (!yearParam) {
    return { year: new Date().getFullYear(), yearmode: 'YEAR' };
  }
  if (yearParam === 'ALL') {
    return { year: new Date().getFullYear(), yearmode: 'ALL' };
  }
  return { year: parseInt(yearParam), yearmode: 'YEAR' };
}

/**
 * Resolves the year string to pass to Supabase RPCs.
 * Returns empty string for ALL mode, otherwise the year string.
 */
export function resolveYearForRpc(yearParam: string | undefined): string {
  if (!yearParam || yearParam === 'ALL') {
    return '';
  }
  return yearParam;
}

/**
 * Categorical chart colors, one set per color scheme. The dark steps are the
 * same hues re-stepped for a dark surface, so a series keeps its identity
 * when the theme is toggled.
 */
export const SERIES_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
} as const;

/**
 * Maps each group to a fixed chart color. Groups are sorted first, so the
 * same set of sections gets the same colors in every chart, whatever order
 * the data arrives in.
 */
export function seriesColors(groups: Iterable<string>, dark: boolean): Record<string, string> {
  const palette = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;
  const sorted = [...new Set(groups)].sort((a, b) => a.localeCompare(b));
  return Object.fromEntries(sorted.map((g, i) => [g, palette[i % palette.length]]));
}

/** Shared fields of the retention detail rows (see get_retention_breakdown). */
interface MemberTrainingRow {
  memberId: number;
  firstname: string;
  lastname: string;
  age: number | null;
  trainingId: number;
  title: string;
  section: string;
  weekday: string | null;
  dateFrom: string | null;
}

/** A member who trained the previous year, and whether they stopped. */
export interface RetentionRow extends MemberTrainingRow {
  last_date: string;
  churned: boolean;
}

/** A member who trained for the first time in the selected year. */
export interface NewMemberRow extends MemberTrainingRow {
  first_date: string;
}

export interface CountGroup {
  key: string;
  count: number;
  /** count / all rows, 0..1 */
  share: number;
}

export interface ChurnGroup {
  key: string;
  /** Members of this group who trained the previous year */
  active: number;
  churned: number;
  /** churned / active, 0..1 */
  rate: number;
}

/** Age groups for the churn breakdown; the upper bound is inclusive. */
export const AGE_GROUPS: { key: string; max: number }[] = [
  { key: '0-9', max: 9 },
  { key: '10-13', max: 13 },
  { key: '14-17', max: 17 },
  { key: '18-29', max: 29 },
  { key: '30-49', max: 49 },
  { key: '50+', max: Infinity }
];

export function ageGroup(age: number | null): string {
  if (age === null || age < 0) return 'unknown';
  return AGE_GROUPS.find((g) => age <= g.max)!.key;
}

const AGE_ORDER = [...AGE_GROUPS.map((g) => g.key), 'unknown'];

function byAgeOrder(a: { key: string }, b: { key: string }): number {
  return AGE_ORDER.indexOf(a.key) - AGE_ORDER.indexOf(b.key);
}

function churnGroups(rows: RetentionRow[], keyOf: (r: RetentionRow) => string): ChurnGroup[] {
  const groups = new Map<string, ChurnGroup>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = groups.get(key) ?? { key, active: 0, churned: 0, rate: 0 };
    g.active++;
    if (r.churned) g.churned++;
    groups.set(key, g);
  }
  for (const g of groups.values()) g.rate = g.churned / g.active;
  return [...groups.values()];
}

/** Churn per age group, youngest first, members without birthday last. */
export function churnByAge(rows: RetentionRow[]): ChurnGroup[] {
  return churnGroups(rows, (r) => ageGroup(r.age)).sort(byAgeOrder);
}

/**
 * Churn per training (the one a member attended most), most churned members
 * first. Keys are training ids as strings.
 */
export function churnByTraining(rows: RetentionRow[]): ChurnGroup[] {
  return churnGroups(rows, (r) => String(r.trainingId))
    .filter((g) => g.churned > 0)
    .sort((a, b) => b.churned - a.churned || b.rate - a.rate);
}

function countGroups<T>(rows: T[], keyOf: (r: T) => string): CountGroup[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, count, share: count / rows.length }));
}

/** New members per age group, youngest first, members without birthday last. */
export function countByAge(rows: NewMemberRow[]): CountGroup[] {
  return countGroups(rows, (r) => ageGroup(r.age)).sort(byAgeOrder);
}

/** New members per training (the one they attended most), biggest first. */
export function countByTraining(rows: NewMemberRow[]): CountGroup[] {
  return countGroups(rows, (r) => String(r.trainingId)).sort((a, b) => b.count - a.count);
}
