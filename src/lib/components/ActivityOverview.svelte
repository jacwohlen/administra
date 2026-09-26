<script lang="ts">
  import dayjs from 'dayjs';
  import { _, locale } from 'svelte-i18n';
  import { supabaseClient } from '$lib/supabase';
  import { activityStart, buildActivity, type ActivitySummary } from '$lib/activityUtils';
  import ActivityGrid from './ActivityGrid.svelte';

  /**
   * At-a-glance activity for the profile hero: status, a GitHub-style grid
   * of the last 12 months (the newest weeks stay visible when space is
   * tight) and a few quiet figures.
   */
  let { memberId }: { memberId: number | string } = $props();

  const WEEKS = 53;
  let activity = $state<ActivitySummary | null>(null);

  async function load(id: number | string) {
    const { data } = await supabaseClient
      .from('logs')
      .select('date')
      .eq('memberId', id)
      .gte('date', activityStart(dayjs(), WEEKS).format('YYYY-MM-DD'));
    // Ignore a slow answer for a member that is no longer shown
    if (id !== memberId) return;
    activity = buildActivity(((data ?? []) as { date: string }[]).map((l) => l.date));
  }

  $effect(() => {
    activity = null;
    load(memberId);
  });

  // Empty grid while loading, so the layout does not jump
  let grid = $derived(activity ?? buildActivity([]));

  const statusDot = {
    active: 'bg-success-500',
    paused: 'bg-warning-500',
    inactive: 'bg-surface-400-600'
  };

  let perWeek = $derived(
    activity
      ? new Intl.NumberFormat($locale ?? 'de', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1
        }).format(activity.perWeek)
      : ''
  );

  function lastTrained(a: ActivitySummary): string {
    if (a.daysSince === null) return $_('activity.never');
    if (a.daysSince === 0) return $_('activity.lastToday');
    if (a.daysSince === 1) return $_('activity.lastYesterday');
    return $_('activity.lastDaysAgo', { values: { n: a.daysSince } });
  }
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between gap-2 text-sm">
    {#if activity}
      <span class="inline-flex items-center gap-2 font-semibold">
        <span class="size-2.5 rounded-full {statusDot[activity.status]}" aria-hidden="true"></span>
        {$_('activity.status.' + activity.status)}
      </span>
      {#if activity.lastDate}
        <span class="text-surface-600-400"
          >{$_('activity.perWeek', { values: { n: perWeek } })}</span
        >
      {/if}
    {:else}
      <span class="placeholder h-4 w-24 animate-pulse"></span>
    {/if}
  </div>

  <ActivityGrid weeks={grid.weeks} loading={!activity} />

  {#if activity}
    <p class="text-xs text-surface-600-400">
      {lastTrained(activity)}{activity.lastDate
        ? ' · ' + $_('activity.last30', { values: { n: activity.last30 } })
        : ''}
    </p>
  {/if}
</div>
