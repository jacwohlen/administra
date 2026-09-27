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
