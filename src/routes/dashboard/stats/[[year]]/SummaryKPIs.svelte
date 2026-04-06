<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import { onMount } from 'svelte';

  interface StatsSummary {
    total_training_sessions: number;
    total_unique_participants: number;
    total_events: number;
    avg_attendance_per_training: number;
    avg_attendance_per_event: number;
  }

  let summary: StatsSummary | null = $state(null);

  async function loadSummary() {
    const yearParam = yearmode === 'ALL' ? '' : year.toString();
    const { data } = await supabaseClient
      .rpc('get_stats_summary', { year_param: yearParam })
      .returns<StatsSummary>()
      .single();
    summary = data ?? null;
  }

  onMount(() => {
    loadSummary();
  });

  $effect(() => {
    if (year || yearmode) {
      loadSummary();
    }
  });
</script>

{#if summary}
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
    <div class="card p-4 text-center">
      <p class="text-3xl font-bold">{summary.total_training_sessions}</p>
      <p class="text-sm text-surface-600-400">{$_('page.stats.totalTrainingSessions')}</p>
    </div>
    <div class="card p-4 text-center">
      <p class="text-3xl font-bold">{summary.total_unique_participants}</p>
      <p class="text-sm text-surface-600-400">{$_('page.stats.uniqueParticipants')}</p>
    </div>
    <div class="card p-4 text-center">
      <p class="text-3xl font-bold">{summary.total_events}</p>
      <p class="text-sm text-surface-600-400">{$_('page.stats.totalEvents')}</p>
    </div>
    <div class="card p-4 text-center">
      <p class="text-3xl font-bold">{summary.avg_attendance_per_training ?? '-'}</p>
      <p class="text-sm text-surface-600-400">{$_('page.stats.avgAttendanceTraining')}</p>
    </div>
    <div class="card p-4 text-center">
      <p class="text-3xl font-bold">{summary.avg_attendance_per_event ?? '-'}</p>
      <p class="text-sm text-surface-600-400">{$_('page.stats.avgAttendanceEvent')}</p>
    </div>
  </div>
{/if}
