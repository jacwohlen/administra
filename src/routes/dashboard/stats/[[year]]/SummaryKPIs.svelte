<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import { supabaseClient } from '$lib/supabase';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCalendarCheck,
    faUsers,
    faTrophy,
    faPeopleGroup,
    faMedal
  } from '@fortawesome/free-solid-svg-icons';

  interface StatsSummary {
    total_training_sessions: number;
    total_unique_participants: number;
    total_events: number;
    avg_attendance_per_training: number | null;
    avg_attendance_per_event: number | null;
  }

  let summary = $state<StatsSummary | null>(null);

  async function loadSummary(mode: 'YEAR' | 'ALL', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const { data } = await supabaseClient
      .rpc('get_stats_summary', { year_param: yearParam })
      .returns<StatsSummary>()
      .single();
    // Ignore a slow answer for a period that is no longer shown
    if (mode !== yearmode || y !== year) return;
    summary = data ?? null;
  }

  $effect(() => {
    summary = null;
    loadSummary(yearmode, year);
  });

  function format(value: number | null | undefined): string {
    if (value === null || value === undefined) return '–';
    return new Intl.NumberFormat($locale ?? 'de', { maximumFractionDigits: 1 }).format(
      Number(value)
    );
  }

  let tiles = $derived([
    {
      icon: faCalendarCheck,
      label: $_('page.stats.totalTrainingSessions'),
      value: summary?.total_training_sessions
    },
    {
      icon: faUsers,
      label: $_('page.stats.uniqueParticipants'),
      value: summary?.total_unique_participants
    },
    {
      icon: faPeopleGroup,
      label: $_('page.stats.avgAttendanceTraining'),
      value: summary?.avg_attendance_per_training
    },
    { icon: faTrophy, label: $_('page.stats.totalEvents'), value: summary?.total_events },
    {
      icon: faMedal,
      label: $_('page.stats.avgAttendanceEvent'),
      value: summary?.avg_attendance_per_event
    }
  ]);
</script>

<section class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
  {#each tiles as tile, i (tile.label)}
    <div
      class="card border border-surface-200-800 p-3 flex items-center gap-3 min-w-0 {i === 0
        ? 'col-span-2 sm:col-span-1'
        : ''}"
    >
      <div class="entity-badge text-primary-600-400"><Fa icon={tile.icon} /></div>
      <div class="min-w-0">
        {#if summary}
          <div class="text-2xl font-bold leading-tight tabular-nums">{format(tile.value)}</div>
        {:else}
          <div class="placeholder animate-pulse h-7 w-12"></div>
        {/if}
        <div class="text-xs leading-tight text-surface-600-400 hyphens-auto break-words">
          {tile.label}
        </div>
      </div>
    </div>
  {/each}
</section>
