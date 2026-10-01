<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import { supabaseClient } from '$lib/supabase';
  import { seriesColors } from '$lib/statsUtils';
  import { _ } from 'svelte-i18n';
  import ChartFrame from './ChartFrame.svelte';
  import { baseChartOptions } from './chartOptions';

  interface SectionData {
    section: string;
    count: number;
  }

  const HEIGHT = 280;

  async function loadSectionData(mode: 'ALL' | 'YEAR', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const { data } = await supabaseClient.rpc('get_attendance_by_section', {
      year_param: yearParam
    });
    return (data as SectionData[]) ?? [];
  }

  let data = $derived(loadSectionData(yearmode, year));
</script>

{#await data}
  <div class="placeholder animate-pulse w-full" style:height="{HEIGHT}px"></div>
{:then rows}
  {#if rows.length > 0}
    <ChartFrame height={HEIGHT}>
      {#snippet children(dark, { DonutChart })}
        <DonutChart
          data={rows.map((r) => ({ group: r.section, value: r.count }))}
          options={{
            ...baseChartOptions(dark, HEIGHT),
            donut: { center: { label: $_('page.stats.totalAttendance') } },
            color: {
              scale: seriesColors(
                rows.map((r) => r.section),
                dark
              )
            }
          }}
        />
      {/snippet}
    </ChartFrame>
  {:else}
    <p class="empty-state">{$_('page.stats.no_data')}</p>
  {/if}
{/await}
