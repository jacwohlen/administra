<script lang="ts">
  import dayjs from 'dayjs';
  import type { Log } from '$lib/models';
  import { buildActivity } from '$lib/activityUtils';
  import ActivityGrid from '$lib/components/ActivityGrid.svelte';

  // Same grid and colour scale as the activity overview in the profile hero,
  // for one calendar year.
  let { logs, year }: { logs: Promise<Log[]>; year: number } = $props();

  let yearStart = $derived(dayjs(`${year}-01-01`));
  // The running year ends today, like the overview; past years on 31 December
  let end = $derived.by(() => {
    const today = dayjs().startOf('day');
    const yearEnd = dayjs(`${year}-12-31`);
    return yearEnd.isBefore(today) ? yearEnd : today;
  });
  let weekCount = $derived(monday(end).diff(monday(yearStart), 'week') + 1);

  function monday(d: dayjs.Dayjs) {
    return d.subtract((d.day() + 6) % 7, 'day');
  }

  function weeksFor(l: Log[]) {
    const weeks = buildActivity(
      l.map((log) => log.date),
      end,
      weekCount
    ).weeks;
    // Label January on the first column; the grid never reaches next year
    if (weeks.length) weeks[0] = { ...weeks[0], monthStart: 0 };
    return weeks;
  }
</script>

{#await logs}
  <ActivityGrid
    weeks={weeksFor([])}
    hideBefore={yearStart.format('YYYY-MM-DD')}
    loading
    scrollable
  />
{:then l}
  <ActivityGrid weeks={weeksFor(l)} hideBefore={yearStart.format('YYYY-MM-DD')} scrollable />
{:catch err}
  {err}
{/await}
