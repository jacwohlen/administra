<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import { ScaleTypes } from '@carbon/charts/interfaces';
  import { supabaseClient } from '$lib/supabase';
  import { seriesColors } from '$lib/statsUtils';
  import { _, locale } from 'svelte-i18n';
  import ChartFrame from './ChartFrame.svelte';
  import { baseChartOptions } from './chartOptions';

  interface TrainingAttendance {
    trainingId: number;
    title: string;
    section: string;
    avg_attendance: number;
  }

  interface TrainingSlot {
    id: number;
    weekday: string | null;
    dateFrom: string | null;
  }

  interface SessionCount {
    trainingId: number;
    date: string;
    count: number;
  }

  const HEIGHT = 240;

  /**
   * Average attendance per training as a ranked list; the selected training's
   * sessions are plotted above it, one line at a time so it stays readable.
   */
  async function loadData(mode: 'ALL' | 'YEAR', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const [avg, sessions] = await Promise.all([
      supabaseClient.rpc('get_avg_attendance_by_training', { year_param: yearParam }),
      supabaseClient
        .from('view_logs_summary')
        .select('trainingId, date, count')
        .like('date', yearParam + '%')
        .order('date')
        .returns<SessionCount[]>()
    ]);
    const rows = (avg.data as TrainingAttendance[]) ?? [];
    // Several trainings share a title ("Judo Kinder"); weekday and start
    // time tell them apart
    const { data: slots } = await supabaseClient
      .from('trainings')
      .select('id, weekday, dateFrom')
      .in(
        'id',
        rows.map((t) => t.trainingId)
      )
      .returns<TrainingSlot[]>();
    const slotById = new Map((slots ?? []).map((s) => [Number(s.id), s]));
    const trainings = rows
      .map((t) => ({
        ...t,
        avg_attendance: Number(t.avg_attendance),
        slot: slotLabel(slotById.get(t.trainingId))
      }))
      .sort((a, b) => b.avg_attendance - a.avg_attendance);
    return { trainings, sessions: sessions.data ?? [] };
  }

  function slotLabel(slot: TrainingSlot | undefined): string {
    if (!slot) return '';
    const day = slot.weekday ? $_('weekdayShort.' + slot.weekday) : '';
    return [day, slot.dateFrom?.slice(0, 5)].filter(Boolean).join(' ');
  }

  let data = $derived(loadData(yearmode, year));
  let selectedId: number | null = $state(null);

  let fmt = $derived(
    new Intl.NumberFormat($locale ?? 'de', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })
  );
</script>

{#await data}
  <div class="placeholder animate-pulse w-full mb-4" style:height="{HEIGHT}px"></div>
{:then { trainings, sessions }}
  {#if trainings.length > 0}
    {@const selected = trainings.find((t) => t.trainingId === selectedId) ?? trainings[0]}
    {@const max = trainings[0].avg_attendance || 1}
    {@const series = sessions
      .filter((s) => s.trainingId === selected.trainingId)
      .map((s) => ({ group: selected.title, date: s.date, value: s.count }))}

    <div class="rounded-container bg-surface-100-900/50 p-3 mb-4">
      <div class="flex items-start justify-between gap-2 mb-1">
        <div class="min-w-0">
          <div class="font-semibold truncate">{selected.title}</div>
          <div class="text-xs text-surface-600-400 truncate">
            {[selected.slot, selected.section].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span class="text-xs text-surface-600-400 flex-none tabular-nums">
          {$_('page.stats.sessionsCount', { values: { count: series.length } })}
        </span>
      </div>
      {#if series.length > 0}
        <ChartFrame height={HEIGHT}>
          {#snippet children(dark, { LineChart })}
            <LineChart
              data={series}
              options={{
                ...baseChartOptions(dark, HEIGHT),
                axes: {
                  bottom: { mapsTo: 'date', scaleType: ScaleTypes.TIME },
                  left: {
                    mapsTo: 'value',
                    title: $_('page.stats.attendance'),
                    scaleType: ScaleTypes.LINEAR
                  }
                },
                color: {
                  scale: {
                    [selected.title]: seriesColors(
                      trainings.map((t) => t.section),
                      dark
                    )[selected.section]
                  }
                },
                // Month names only when a single year is shown
                ...(yearmode === 'YEAR'
                  ? {
                      timeScale: {
                        timeIntervalFormats: { monthly: { primary: 'MMM', secondary: 'MMM' } }
                      }
                    }
                  : {}),
                points: { radius: 3 },
                legend: { enabled: false }
              }}
            />
          {/snippet}
        </ChartFrame>
      {:else}
        <p class="empty-state">{$_('page.stats.no_data')}</p>
      {/if}
    </div>

    <p class="text-xs text-surface-600-400 mb-2">{$_('page.stats.selectTrainingHint')}</p>
    <ol class="space-y-1">
      {#each trainings as t (t.trainingId)}
        {@const active = t.trainingId === selected.trainingId}
        <li>
          <button
            type="button"
            class="w-full grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_3rem] items-center gap-3 px-2 py-1.5 rounded text-left hover:bg-surface-100-900"
            class:bg-surface-100-900={active}
            aria-pressed={active}
            onclick={() => (selectedId = t.trainingId)}
          >
            <span class="min-w-0">
              <span class="block truncate text-sm" class:font-semibold={active}>{t.title}</span>
              <span class="block truncate text-xs text-surface-600-400"
                >{[t.slot, t.section].filter(Boolean).join(' · ')}</span
              >
            </span>
            <span class="h-3 rounded-sm bg-surface-200-800 overflow-hidden" aria-hidden="true">
              <span
                class="block h-full rounded-sm {active ? 'bg-primary-500' : 'bg-surface-400-600'}"
                style:width="{(t.avg_attendance / max) * 100}%"
              ></span>
            </span>
            <span class="text-sm font-semibold tabular-nums text-right"
              >{fmt.format(t.avg_attendance)}</span
            >
          </button>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty-state">{$_('page.stats.no_data')}</p>
  {/if}
{/await}
