<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import type { ChartTabularData } from '@carbon/charts-svelte';
  import { ScaleTypes } from '@carbon/charts/interfaces';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { seriesColors } from '$lib/statsUtils';
  import { _ } from 'svelte-i18n';
  import ChartFrame from './ChartFrame.svelte';
  import { baseChartOptions } from './chartOptions';

  interface MonthlyData {
    month: string;
    section: string;
    count: number;
  }

  const HEIGHT = 300;

  async function loadMonthlyData(mode: 'ALL' | 'YEAR', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const { data } = await supabaseClient.rpc('get_monthly_attendance', {
      year_param: yearParam
    });
    return (data as MonthlyData[]) ?? [];
  }

  // Short month names; across all years the year is needed to tell them apart
  function monthLabel(month: string, mode: 'ALL' | 'YEAR'): string {
    return dayjs(month + '-01').format(mode === 'ALL' ? 'MMM YY' : 'MMM');
  }

  function toChart(rows: MonthlyData[], mode: 'ALL' | 'YEAR'): ChartTabularData {
    return rows.map((item) => ({
      group: item.section,
      key: monthLabel(item.month, mode),
      value: item.count
    }));
  }

  let data = $derived(loadMonthlyData(yearmode, year));
</script>

{#await data}
  <div class="placeholder animate-pulse w-full" style:height="{HEIGHT}px"></div>
{:then rows}
  {#if rows.length > 0}
    <ChartFrame height={HEIGHT}>
      {#snippet children(dark, { BarChartStacked })}
        <BarChartStacked
          data={toChart(rows, yearmode)}
          options={{
            ...baseChartOptions(dark, HEIGHT),
            axes: {
              bottom: { mapsTo: 'key', scaleType: ScaleTypes.LABELS },
              left: {
                mapsTo: 'value',
                title: $_('page.stats.attendance'),
                stacked: true,
                scaleType: ScaleTypes.LINEAR
              }
            },
            color: {
              scale: seriesColors(
                rows.map((r) => r.section),
                dark
              )
            },
            bars: { maxWidth: 28 }
          }}
        />
      {/snippet}
    </ChartFrame>
  {:else}
    <p class="empty-state">{$_('page.stats.no_data')}</p>
  {/if}
{/await}
