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
