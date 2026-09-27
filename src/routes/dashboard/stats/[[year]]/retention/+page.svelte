<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowLeft, faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';
  import dayjs from 'dayjs';
  import { _, locale } from 'svelte-i18n';
  import { supabaseClient } from '$lib/supabase';
  import {
    churnByAge,
    churnByTraining,
    countByAge,
    countByTraining,
    type NewMemberRow,
    type RetentionRow
  } from '$lib/statsUtils';
  import type { PageData } from './$types';
  import StatsSection from '../StatsSection.svelte';
  import MemberRetention from '../MemberRetention.svelte';
  import GroupBars, { type GroupBar } from './GroupBars.svelte';
  import MemberList from './MemberList.svelte';

  /**
   * Details behind the retention figures: who left and who joined, by age
   * group and by training, with the names behind the numbers.
   */
  let { data }: { data: PageData } = $props();

  let year = $derived(data.year);
  let currentYear = new Date().getFullYear();

  async function rpc<T>(fn: string, y: number): Promise<T[]> {
    const { data: rows, error } = await supabaseClient.rpc(fn, { year_param: y.toString() });
    if (error) throw new Error(error.message);
    return (rows as T[]) ?? [];
  }

  let churn = $derived(rpc<RetentionRow>('get_retention_breakdown', year));
  let joined = $derived(rpc<NewMemberRow>('get_new_member_breakdown', year));

  let percent = $derived(
    new Intl.NumberFormat($locale ?? 'de', { style: 'percent', maximumFractionDigits: 0 })
  );

  function ageLabel(key: string): string {
    if (key === 'unknown') return $_('page.stats.churn.ageUnknown');
    return $_('page.stats.churn.ageGroup', { values: { group: key.replace('-', '–') } });
  }

  type TrainingRef = Pick<RetentionRow, 'weekday' | 'dateFrom' | 'section'>;

  function trainingSub(r: TrainingRef): string {
    const day = r.weekday ? $_('weekdayShort.' + r.weekday) : '';
    const slot = [day, r.dateFrom?.slice(0, 5)].filter(Boolean).join(' ');
    return [slot, r.section].filter(Boolean).join(' · ');
  }

  function training<T extends TrainingRef & { trainingId: number; title: string }>(
    rows: T[],
    key: string
  ) {
    const r = rows.find((row) => String(row.trainingId) === key)!;
    return { title: r.title, sub: trainingSub(r) };
  }

  function memberSub(r: RetentionRow | NewMemberRow): string {
    return [r.age !== null ? $_('page.members.age', { values: { age: r.age } }) : '', r.title]
      .filter(Boolean)
      .join(' · ');
  }

  function churnBars(
    rows: RetentionRow[],
    groups: ReturnType<typeof churnByAge>,
    byTraining: boolean
  ): GroupBar[] {
    return groups.map((g) => ({
      key: g.key,
      ...(byTraining ? training(rows, g.key) : { title: ageLabel(g.key) }),
      fill: g.rate,
      value: percent.format(g.rate),
      detail: `${g.churned}/${g.active}`
    }));
  }

  function joinBars(
    rows: NewMemberRow[],
    groups: ReturnType<typeof countByAge>,
    byTraining: boolean
  ): GroupBar[] {
    const max = Math.max(...groups.map((g) => g.count), 1);
    return groups.map((g) => ({
      key: g.key,
      ...(byTraining ? training(rows, g.key) : { title: ageLabel(g.key) }),
      fill: g.count / max,
      value: String(g.count),
      detail: percent.format(g.share)
    }));
  }
</script>

<div class="space-y-4">
  <div class="page-header-back mb-0!">
    <a
      href="/dashboard/stats/{year}"
      class="btn preset-tonal-surface flex-shrink-0"
      aria-label={$_('page.dashboard.stats')}
    >
      <Fa icon={faArrowLeft} />
    </a>
    <h1 class="flex-1 min-w-0 mb-0! hyphens-auto break-words">
      {$_('page.stats.memberRetention')}
    </h1>
    <div class="flex items-center flex-shrink-0">
      <button
        class="btn-icon preset-tonal-surface"
        aria-label="{$_('button.year')} -1"
        onclick={() => goto(`/dashboard/stats/${year - 1}/retention`)}
      >
        <Fa icon={faChevronLeft} />
      </button>
      <span class="w-14 text-center font-semibold tabular-nums">{year}</span>
      <button
        class="btn-icon preset-tonal-surface"
        aria-label="{$_('button.year')} +1"
        disabled={year >= currentYear}
        onclick={() => goto(`/dashboard/stats/${year + 1}/retention`)}
      >
        <Fa icon={faChevronRight} />
      </button>
    </div>
  </div>

  <StatsSection title={$_('page.stats.retentionOverview', { values: { prev: year - 1, year } })}>
    <MemberRetention yearmode="YEAR" {year} />
  </StatsSection>

  <StatsSection
    title={$_('page.stats.churn.title', { values: { year } })}
    hint={$_('page.stats.churn.hint', { values: { prev: year - 1, year } })}
  >
    {#await churn}
      <div class="placeholder animate-pulse h-48"></div>
    {:then rows}
      {@const gone = rows.filter((r) => r.churned)}
      {#if gone.length > 0}
        <div class="grid gap-6 md:grid-cols-2">
          <GroupBars
            title={$_('page.stats.churn.byAge')}
            tone="error"
            items={churnBars(rows, churnByAge(rows), false)}
          />
          <GroupBars
            title={$_('page.stats.churn.byTraining')}
            tone="error"
            limit={8}
            items={churnBars(rows, churnByTraining(rows), true)}
          />
        </div>
        <div class="mt-6">
          <MemberList
            title={$_('page.stats.churn.members', { values: { count: gone.length } })}
            members={gone
              .sort((a, b) => b.last_date.localeCompare(a.last_date))
              .map((r) => ({
                ...r,
                sub: memberSub(r),
                date: $_('page.stats.churn.lastSeen', {
                  values: { date: dayjs(r.last_date).format('D. MMM') }
                })
              }))}
          />
        </div>
      {:else}
        <p class="empty-state">{$_('page.stats.churn.none')}</p>
      {/if}
    {:catch error}
      <p class="text-sm text-error-600-400">{error.message}</p>
    {/await}
  </StatsSection>

  <StatsSection
    title={$_('page.stats.joined.title', { values: { year } })}
    hint={$_('page.stats.joined.hint', { values: { year } })}
  >
    {#await joined}
      <div class="placeholder animate-pulse h-48"></div>
    {:then rows}
      {#if rows.length > 0}
        <div class="grid gap-6 md:grid-cols-2">
          <GroupBars
            title={$_('page.stats.churn.byAge')}
            tone="success"
            items={joinBars(rows, countByAge(rows), false)}
          />
          <GroupBars
            title={$_('page.stats.churn.byTraining')}
            tone="success"
            limit={8}
            items={joinBars(rows, countByTraining(rows), true)}
          />
        </div>
        <div class="mt-6">
          <MemberList
            title={$_('page.stats.joined.members', { values: { count: rows.length } })}
            members={[...rows]
              .sort((a, b) => b.first_date.localeCompare(a.first_date))
              .map((r) => ({
                ...r,
                sub: memberSub(r),
                date: $_('page.stats.joined.since', {
                  values: { date: dayjs(r.first_date).format('D. MMM') }
                })
              }))}
          />
        </div>
      {:else}
        <p class="empty-state">{$_('page.stats.joined.none')}</p>
      {/if}
    {:catch error}
      <p class="text-sm text-error-600-400">{error.message}</p>
    {/await}
  </StatsSection>
</div>
