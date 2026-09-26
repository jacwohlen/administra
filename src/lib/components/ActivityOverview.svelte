<script lang="ts">
  import dayjs from 'dayjs';
  import { _, locale } from 'svelte-i18n';
  import { supabaseClient } from '$lib/supabase';
  import { activityStart, buildActivity, type ActivitySummary } from '$lib/activityUtils';

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
  const cellColor = ['bg-surface-200-800', 'bg-primary-300-700', 'bg-primary-600-400'];

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

  function cellTitle(date: string, count: number): string {
    return $_('activity.cell', { values: { date: dayjs(date).format('DD.MM.YYYY'), n: count } });
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

  <!--
    One column per week (month label + 7 days). Columns grow to fill wide
    screens; below the minimum cell size the rtl wrapper clips the oldest
    weeks on the left, so the newest stay visible.
  -->
  <div class="overflow-hidden" dir="rtl" role="img" aria-label={$_('activity.gridLabel')}>
    <div
      dir="ltr"
      class="grid grid-flow-col gap-[3px] min-w-min"
      class:animate-pulse={!activity}
      style:grid-template-columns="repeat({grid.weeks.length}, minmax(9px, 1fr))"
      style:grid-template-rows="auto repeat(7, auto)"
    >
      {#each grid.weeks as week, i (i)}
        <span class="h-3.5 text-[10px] leading-none text-surface-600-400 whitespace-nowrap">
          {week.monthStart !== null ? dayjs().date(1).month(week.monthStart).format('MMM') : ''}
        </span>
        {#each week.days as day (day.date)}
          {#if day.future}
            <span class="aspect-square"></span>
          {:else}
            <span
              class="aspect-square rounded-[2px] {cellColor[Math.min(day.count, 2)]}"
              title={activity ? cellTitle(day.date, day.count) : undefined}
            ></span>
          {/if}
        {/each}
      {/each}
    </div>
  </div>

  {#if activity}
    <p class="text-xs text-surface-600-400">
      {lastTrained(activity)}{activity.lastDate
        ? ' · ' + $_('activity.last30', { values: { n: activity.last30 } })
        : ''}
    </p>
  {/if}
</div>
