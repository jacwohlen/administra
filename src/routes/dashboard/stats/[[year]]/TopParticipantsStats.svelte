<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import '@carbon/charts/styles.css';
  import { LineChart, type ChartTabularData } from '@carbon/charts-svelte';
  import { ScaleTypes } from '@carbon/charts/interfaces';
  import { supabaseClient } from '$lib/supabase';

  interface LogSummary {
    trainingId: number;
    trainings: { title: string };
    date: string;
    count: number;
  }

  async function getLogsSummary(mode: 'ALL' | 'YEAR', y: number | '') {
    if (mode === 'ALL') y = '';
    const { data } = await supabaseClient
      .from('view_logs_summary')
      .select('trainingId, date, count, trainings (title) as trainingTitle')
      .order('date')
      .like('date', y + '%')
      .returns<LogSummary[]>();
    return data?.map((item) => ({
      group: item.trainings.title,
      date: item.date,
      count: item.count
    })) as ChartTabularData;
  }

  let data = $derived(getLogsSummary(yearmode, year));
</script>

{#await data then items}
  <LineChart
    data={items}
    options={{
      height: '350px',
      grid: {
        x: {
          enabled: false
        },
        y: {
          enabled: false
        }
      },
      axes: {
        bottom: {
          visible: true,
          title: 'Dates',
          mapsTo: 'date',
          scaleType: ScaleTypes.TIME
        },
        left: {
          visible: true,
          mapsTo: 'count',
          scaleType: ScaleTypes.LINEAR
        }
      },
      color: {
        gradient: {
          enabled: false
        }
      },
      points: {
        enabled: false,
        radius: 0
      },
      legend: {
        enabled: true
      }
    }}
  />
{/await}
