<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import '@carbon/charts/styles.css';
  import { BarChartStacked, type ChartTabularData } from '@carbon/charts-svelte';
  import { ScaleTypes } from '@carbon/charts/interfaces';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  interface MonthlyData {
    month: string;
    section: string;
    count: number;
  }

  async function loadMonthlyData(mode: 'ALL' | 'YEAR', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const { data } = await supabaseClient.rpc('get_monthly_attendance', {
      year_param: yearParam
    });
    return ((data as MonthlyData[]) ?? []).map((item: MonthlyData) => ({
      group: item.section,
      key: item.month,
      value: item.count
    })) as ChartTabularData;
  }

  let data = $derived(loadMonthlyData(yearmode, year));
</script>

{#await data then items}
  {#if items && items.length > 0}
    <BarChartStacked
      data={items}
      options={{
        height: '350px',
        grid: {
          x: { enabled: false },
          y: { enabled: false }
        },
        axes: {
          bottom: {
            visible: true,
            title: $_('page.stats.month'),
            mapsTo: 'key',
            scaleType: ScaleTypes.LABELS
          },
          left: {
            visible: true,
            mapsTo: 'value',
            title: $_('page.stats.attendance'),
            scaleType: ScaleTypes.LINEAR
          }
        },
        legend: {
          enabled: true
        }
      }}
    ></BarChartStacked>
  {:else}
    <p class="text-surface-600-400 text-center py-4">{$_('page.stats.no_data')}</p>
  {/if}
{/await}
