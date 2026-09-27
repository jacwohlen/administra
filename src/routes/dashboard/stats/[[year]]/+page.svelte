<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
  import { _ } from 'svelte-i18n';
  import TrainerDownload from './TrainerDownload.svelte';
  import SummaryKPIs from './SummaryKPIs.svelte';
  import MonthlyTrend from './MonthlyTrend.svelte';
  import SectionDistribution from './SectionDistribution.svelte';
  import AttendanceByTraining from './AttendanceByTraining.svelte';
  import TrainerWorkload from './TrainerWorkload.svelte';
  import MemberRetention from './MemberRetention.svelte';
  import BadgeLeaderboard from './BadgeLeaderboard.svelte';
  import StatsSection from './StatsSection.svelte';
  import TopRankings from './TopRankings.svelte';
  import { loadTopEventCoaches, loadTopEventParticipants, loadTopTrainers } from './rankings';

  let { data }: { data: PageData } = $props();

  let yearmode = $derived(data.yearmode);
  let year = $derived(data.year);
  let period = $derived(yearmode === 'ALL' ? 'ALL' : year.toString());
  let currentYear = new Date().getFullYear();

  let topTrainers = $derived(loadTopTrainers(yearmode, year));
  let topEventParticipants = $derived(loadTopEventParticipants(yearmode, year));
  let topEventCoaches = $derived(loadTopEventCoaches(yearmode, year));
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="mb-0!">{$_('page.dashboard.stats')}</h1>
    <div class="flex items-center gap-2">
      {#if yearmode === 'YEAR'}
        <div class="flex items-center">
          <button
            class="btn-icon preset-tonal-surface"
            aria-label="{$_('button.year')} -1"
            onclick={() => goto(`/dashboard/stats/${year - 1}`)}
          >
            <Fa icon={faChevronLeft} />
          </button>
          <span class="w-14 text-center font-semibold tabular-nums">{year}</span>
          <button
            class="btn-icon preset-tonal-surface"
            aria-label="{$_('button.year')} +1"
            disabled={year >= currentYear}
            onclick={() => goto(`/dashboard/stats/${year + 1}`)}
          >
            <Fa icon={faChevronRight} />
          </button>
        </div>
      {/if}
      <SegmentedControl
        name="yearmode"
        value={yearmode}
        onValueChange={(e) => goto('/dashboard/stats/' + (e.value === 'ALL' ? 'ALL' : year))}
      >
        <SegmentedControl.Item value="YEAR">
          <SegmentedControl.ItemHiddenInput />
          <SegmentedControl.ItemText>{$_('button.year')}</SegmentedControl.ItemText>
        </SegmentedControl.Item>
        <SegmentedControl.Item value="ALL">
          <SegmentedControl.ItemHiddenInput />
          <SegmentedControl.ItemText>{$_('page.stats.all')}</SegmentedControl.ItemText>
        </SegmentedControl.Item>
        <SegmentedControl.Indicator />
      </SegmentedControl>
    </div>
  </div>

  <SummaryKPIs {year} {yearmode} />

  <StatsSection title={$_('page.stats.monthlyTrend')}>
    <MonthlyTrend {yearmode} {year} />
  </StatsSection>

  <div class="grid gap-4 md:grid-cols-2">
    <StatsSection title={$_('page.stats.sectionDistribution')}>
      <SectionDistribution {yearmode} {year} />
    </StatsSection>
    <StatsSection title={$_('page.stats.memberRetention')} hint={$_('page.stats.retentionHint')}>
      <MemberRetention {yearmode} {year} />
    </StatsSection>
  </div>

  <StatsSection title={$_('page.stats.attendanceByTraining')}>
    <AttendanceByTraining {yearmode} {year} />
  </StatsSection>

  <TopRankings
    title={$_('page.stats.topAthletes')}
    category="athletes"
    {period}
    rankings={data.topAthletes}
  />

  <StatsSection title={$_('page.stats.trainerWorkload')}>
    {#snippet actions()}
      <TrainerDownload {year} {yearmode} />
    {/snippet}
    <TrainerWorkload {yearmode} {year} />
  </StatsSection>

  <TopRankings
    title={$_('page.stats.topTrainers')}
    category="trainers"
    {period}
    rankings={topTrainers}
  />

  <TopRankings
    title={$_('page.stats.topEventParticipants')}
    category="events"
    {period}
    rankings={topEventParticipants}
    emptyText={$_('page.stats.no_event_data')}
  />

  <TopRankings
    title={$_('page.stats.topEventCoaches')}
    category="coaches"
    {period}
    rankings={topEventCoaches}
    emptyText={$_('page.stats.no_event_data')}
  />

  <BadgeLeaderboard />
</div>
