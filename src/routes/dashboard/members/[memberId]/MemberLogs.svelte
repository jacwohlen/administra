<script lang="ts">
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import type { Log } from '$lib/models';
  import AttendanceGraph from './AttendanceGraph.svelte';
  import AttendanceLog from './AttendanceLog.svelte';
  import AttendanceSummary from './AttendanceSummary.svelte';

  let { memberId }: { memberId: string } = $props();

  let year = $state(new Date().getFullYear());
  let l: Promise<Log[]> = $state(getLogs());

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
      throw err(404, error);
    }

    return data;
  }

  async function previousYear() {
    year = year - 1;
    l = getLogs();
  }

  async function nextYear() {
    year = year + 1;
    l = getLogs();
  }

  function yearStats(logs: Log[]) {
    const asTrainer = logs.filter(
      (log) => log.trainerRole === 'main_trainer' || log.trainerRole === 'assistant'
    ).length;
    return [
      { label: 'page.members.attendance.attended', value: logs.length - asTrainer },
      { label: 'page.members.attendance.asTrainer', value: asTrainer },
      { label: 'page.members.attendance.total', value: logs.length }
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

  <div class="grid grid-cols-3 gap-2">
    {#await l}
      {#each [0, 1, 2] as i (i)}
        <div class="placeholder h-16 animate-pulse"></div>
      {/each}
    {:then logs}
      {#each yearStats(logs) as stat (stat.label)}
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
