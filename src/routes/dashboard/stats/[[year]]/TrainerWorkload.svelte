<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import '@carbon/charts/styles.css';
  import { BarChartStacked, type ChartTabularData } from '@carbon/charts-svelte';
  import { ScaleTypes } from '@carbon/charts/interfaces';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  interface TrainerData {
    memberId: number;
    lastname: string;
    firstname: string;
    main_trainer_count: number;
    assistant_count: number;
    total_count: number;
  }

  async function loadData(mode: 'ALL' | 'YEAR', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const { data } = await supabaseClient.rpc('get_trainer_workload', {
      year_param: yearParam
    });
    const trainers = (data as TrainerData[]) ?? [];

    if (trainers.length === 0) return [] as ChartTabularData;

    const chartData: ChartTabularData = [];
    for (const trainer of trainers) {
      const name = `${trainer.firstname} ${trainer.lastname}`;
      chartData.push({
        group: $_('page.stats.mainTrainer'),
        key: name,
        value: trainer.main_trainer_count
      });
      chartData.push({
        group: $_('page.stats.assistant'),
        key: name,
        value: trainer.assistant_count
      });
    }
    return chartData;
  }

  let data = $derived(loadData(yearmode, year));
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
            mapsTo: 'key',
            scaleType: ScaleTypes.LABELS
          },
          left: {
            visible: true,
            mapsTo: 'value',
            title: $_('page.stats.sessions'),
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
