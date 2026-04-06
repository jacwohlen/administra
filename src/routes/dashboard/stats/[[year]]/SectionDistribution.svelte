<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import '@carbon/charts/styles.css';
  import { DonutChart, type ChartTabularData } from '@carbon/charts-svelte';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  interface SectionData {
    section: string;
    count: number;
  }

  async function loadSectionData(mode: 'ALL' | 'YEAR', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const { data } = await supabaseClient.rpc('get_attendance_by_section', {
      year_param: yearParam
    });
    return ((data as SectionData[]) ?? []).map((item: SectionData) => ({
      group: item.section,
      value: item.count
    })) as ChartTabularData;
  }

  let data = $derived(loadSectionData(yearmode, year));
</script>

{#await data then items}
  {#if items && items.length > 0}
    <DonutChart
      data={items}
      options={{
        height: '350px',
        resizable: true,
        legend: {
          enabled: true,
          alignment: 'center'
        },
        donut: {
          center: {
            label: $_('page.stats.totalAttendance')
          }
        }
      }}
    />
  {:else}
    <p class="text-surface-600-400 text-center py-4">{$_('page.stats.no_data')}</p>
  {/if}
{/await}
