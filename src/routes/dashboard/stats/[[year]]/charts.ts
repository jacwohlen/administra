import type * as CarbonCharts from '@carbon/charts-svelte';

export type Charts = typeof CarbonCharts;

let charts: Promise<Charts> | undefined;

/** Loads Carbon Charts and its stylesheet once, on first use. */
export function loadCharts(): Promise<Charts> {
  charts ??= Promise.all([
    import('@carbon/charts-svelte'),
    import('@carbon/charts/styles.css')
  ]).then(([lib]) => lib);
  return charts;
}
