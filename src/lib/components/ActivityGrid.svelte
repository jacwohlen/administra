<script lang="ts">
  import dayjs from 'dayjs';
  import { _ } from 'svelte-i18n';
  import type { ActivityWeek } from '$lib/activityUtils';

  /**
   * GitHub-style attendance grid: one column per week (month label + 7 days,
   * Monday first). Columns grow to fill wide screens; below the minimum cell
   * size the rtl wrapper keeps the newest weeks in view (clipped, or
   * scrollable with `scrollable`).
   */
  let {
    weeks,
    loading = false,
    hideBefore = null,
    scrollable = false
  }: {
    weeks: ActivityWeek[];
    loading?: boolean;
    /** YYYY-MM-DD: days before it are left blank (e.g. the previous year) */
    hideBefore?: string | null;
    scrollable?: boolean;
  } = $props();

  // 0, 1 and 2+ trainings per day: same scale everywhere
  const cellColor = ['bg-surface-200-800', 'bg-primary-300-700', 'bg-primary-600-400'];

  function cellTitle(date: string, count: number): string {
    return $_('activity.cell', { values: { date: dayjs(date).format('DD.MM.YYYY'), n: count } });
  }
</script>

<div
  class={scrollable ? 'overflow-x-auto pb-1' : 'overflow-hidden'}
  dir="rtl"
  role="img"
  aria-label={$_('activity.gridLabel')}
>
  <div
    dir="ltr"
    class="grid grid-flow-col gap-[3px] min-w-min"
    class:animate-pulse={loading}
    style:grid-template-columns="repeat({weeks.length}, minmax(9px, 1fr))"
    style:grid-template-rows="auto repeat(7, auto)"
  >
    {#each weeks as week, i (i)}
      <span class="h-3.5 text-[10px] leading-none text-surface-600-400 whitespace-nowrap">
        {week.monthStart !== null ? dayjs().date(1).month(week.monthStart).format('MMM') : ''}
      </span>
      {#each week.days as day (day.date)}
        {#if day.future || (hideBefore && day.date < hideBefore)}
          <span class="aspect-square"></span>
        {:else}
          <span
            class="aspect-square rounded-[2px] {cellColor[Math.min(day.count, 2)]}"
            title={loading ? undefined : cellTitle(day.date, day.count)}
          ></span>
        {/if}
      {/each}
    {/each}
  </div>
</div>
