<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import '@carbon/charts/styles.css';
  import { BarChartGrouped, type ChartTabularData } from '@carbon/charts-svelte';
  import { ScaleTypes } from '@carbon/charts/interfaces';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  interface TrainingAttendance {
    trainingId: number;
    title: string;
    section: string;
    avg_attendance: number;
  }

  async function loadData(mode: 'ALL' | 'YEAR', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const { data } = await supabaseClient.rpc('get_avg_attendance_by_training', {
      year_param: yearParam
    });
    return ((data as TrainingAttendance[]) ?? []).map((item: TrainingAttendance) => ({
      group: item.section,
      key: item.title,
      value: Number(item.avg_attendance)
    })) as ChartTabularData;
  }

  let data = $derived(loadData(yearmode, year));
</script>

{#await data then items}
  {#if items && items.length > 0}
    <BarChartGrouped
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
            title: $_('page.stats.training'),
            mapsTo: 'key',
            scaleType: ScaleTypes.LABELS
          },
          left: {
            visible: true,
            mapsTo: 'value',
            title: $_('page.stats.avgAttendance'),
            scaleType: ScaleTypes.LINEAR
          }
        },
        legend: {
          enabled: true
        }
      }}
    ></BarChartGrouped>
  {:else}
    <p class="text-surface-600-400 text-center py-4">{$_('page.stats.no_data')}</p>
  {/if}
{/await}
