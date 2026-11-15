<script lang="ts">
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '#lib/supabase.ts';
  import { _ } from 'svelte-i18n';
  import type { CoachDay, Log } from '#lib/models.ts';
  import { coachingDayCounts, endsOnOrAfter, type CoachingEntry } from '#lib/eventUtils.ts';
  import AttendanceGraph from './AttendanceGraph.svelte';
  import AttendanceLog from './AttendanceLog.svelte';
  import AttendanceSummary from './AttendanceSummary.svelte';

  let { memberId }: { memberId: string } = $props();

  let year = $state(new Date().getFullYear());
  let l: Promise<Log[]> = $state(getLogs());
  let coaching: Promise<CoachingEntry[]> = $state(getCoaching());

  async function getLogs() {
    // Fetch logs
    const { error, data } = await supabaseClient
      .from('logs')
      .select('date, trainingId ( id, title, section, weekday ), trainerRole')
      .eq('memberId', memberId)
      .gte('date', year + '-01-01')
      .lte('date', year + '-12-31')
      .order('date', { ascending: false })
      .returns<Log[]>();

    if (error) {
      throw err(404, error.message);
    }

    return data;
  }

  /** Events coached: every day of the event in the year counts, full or half */
  async function getCoaching(): Promise<CoachingEntry[]> {
    const from = year + '-01-01';
    const to = year + '-12-31';
    const { error, data } = await supabaseClient
      .from('event_logs')
      .select('coachDay, events:eventId!inner ( date, date_to )')
      .eq('memberId', memberId)
      .eq('isCoach', true)
      .lte('events.date', to)
      .or(endsOnOrAfter(from), { referencedTable: 'events' })
      .returns<{ coachDay: CoachDay; events: { date: string; date_to: string | null } }[]>();

    if (error) {
      throw err(404, error.message);
    }

    return data.map((row) => ({ coachDay: row.coachDay, event: row.events }));
  }

  function load() {
    l = getLogs();
    coaching = getCoaching();
  }

  async function previousYear() {
    year = year - 1;
    load();
  }

  async function nextYear() {
    year = year + 1;
    load();
  }

  function yearStats(logs: Log[], entries: CoachingEntry[]) {
    const asMainTrainer = logs.filter((log) => log.trainerRole === 'main_trainer').length;
    const asAssistant = logs.filter((log) => log.trainerRole === 'assistant').length;
    const days = coachingDayCounts(entries, year + '-01-01', year + '-12-31');
    return [
      {
        label: 'page.members.attendance.attended',
        value: logs.length - asMainTrainer - asAssistant
      },
      { label: 'page.members.attendance.asMainTrainer', value: asMainTrainer },
      { label: 'page.members.attendance.asAssistant', value: asAssistant },
      { label: 'page.members.attendance.total', value: logs.length },
      { label: 'page.members.attendance.coachFullDays', value: days.full },
      { label: 'page.members.attendance.coachHalfDays', value: days.half }
    ];
  }
</script>

<section class="card border border-surface-200-800 p-4 space-y-4">
  <div class="flex items-center justify-between gap-2">
    <h3 class="mb-0!">{$_('page.members.attendance.title')}</h3>
    <div class="flex items-center gap-1">
      <button
        class="btn btn-icon preset-tonal-surface"
        onclick={previousYear}
        title={$_('page.members.attendance.previousYear')}
        aria-label={$_('page.members.attendance.previousYear')}
      >
        <Fa icon={faChevronLeft} />
      </button>
      <span class="w-14 text-center font-semibold tabular-nums">{year}</span>
      <button
        class="btn btn-icon preset-tonal-surface"
        onclick={nextYear}
        title={$_('page.members.attendance.nextYear')}
        aria-label={$_('page.members.attendance.nextYear')}
      >
        <Fa icon={faChevronRight} />
      </button>
    </div>
  </div>

  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
    {#await Promise.all([l, coaching])}
      {#each [0, 1, 2, 3, 4, 5] as i (i)}
        <div class="placeholder h-16 animate-pulse"></div>
      {/each}
    {:then [logs, entries]}
      {#each yearStats(logs, entries) as stat (stat.label)}
        <div class="rounded-container bg-surface-100-900 p-3 text-center">
          <div class="text-2xl font-bold tabular-nums">{stat.value}</div>
          <div class="text-xs text-surface-600-400">{$_(stat.label)}</div>
        </div>
      {/each}
    {:catch}
      <!-- errors are shown by the sections below -->
    {/await}
  </div>

  <AttendanceGraph logs={l} {year} />
</section>
<section class="card border border-surface-200-800 p-4">
  <AttendanceSummary logs={l} />
</section>
<section class="card border border-surface-200-800 p-4">
  <AttendanceLog logs={l} />
</section>
