import { ChartTheme } from '@carbon/charts/interfaces';

/**
 * Options every chart on the stats page shares: theme per color scheme, no
 * toolbar (the legend already toggles series), quiet grid lines.
 */
export function baseChartOptions(dark: boolean, height: number) {
  return {
    theme: dark ? ChartTheme.G100 : ChartTheme.WHITE,
    height: `${height}px`,
    resizable: true,
    toolbar: { enabled: false },
    grid: {
      x: { enabled: false },
      y: { enabled: true }
    },
    legend: { alignment: 'center' as const, clickable: true }
  };
}
