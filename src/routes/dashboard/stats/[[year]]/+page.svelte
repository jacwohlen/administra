<script lang="ts">
  import TopAthletes from './TopAthletes.svelte';
  import Fa from 'svelte-fa';
  import { faArrowRight, faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import TopParticipantsStats from './TopParticipantsStats.svelte';
  import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
  import { _ } from 'svelte-i18n';
  import TopTrainers from './TopTrainers.svelte';
  import TopEventParticipants from './TopEventParticipants.svelte';
  import TopEventCoaches from './TopEventCoaches.svelte';
  import TrainerDownload from './TrainerDownload.svelte';

  let { data }: { data: PageData } = $props();

  let yearmode = $derived(data.yearmode);
  let year = $derived(data.year);

  async function previousYear() {
    if (yearmode === 'YEAR') year = year - 1;
    // FIXME: How to this more elegantly (not needing to put base path?
    goto(`/dashboard/stats/${year.toString()}`);
  }

  async function nextYear() {
    if (yearmode === 'YEAR') year = year + 1;
    goto(`/dashboard/stats/${year.toString()}`);
  }
</script>

<div class="flex justify-between items-center m-2">
  <div>
    <button class="btn" onclick={previousYear}>
      <Fa icon={faArrowLeft} /><span>{$_('button.year')}</span>
    </button>
  </div>
  <div>
    <SegmentedControl
      name="yearmode"
      defaultValue={yearmode}
      onValueChange={(e) => {
        if (e.value === 'YEAR') {
          goto('/dashboard/stats/' + year);
        } else {
          goto('/dashboard/stats/ALL');
        }
      }}
    >
      <SegmentedControl.Item value="YEAR">
        <SegmentedControl.ItemHiddenInput />
        <SegmentedControl.ItemText>{year}</SegmentedControl.ItemText>
      </SegmentedControl.Item>
      <SegmentedControl.Item value="ALL">
        <SegmentedControl.ItemHiddenInput />
        <SegmentedControl.ItemText>{$_('page.stats.all')}</SegmentedControl.ItemText>
      </SegmentedControl.Item>
      <SegmentedControl.Indicator />
    </SegmentedControl>
  </div>
  <div>
    <button class="btn" onclick={nextYear}>
      <span>{$_('button.year')}</span><Fa icon={faArrowRight} />
    </button>
  </div>
</div>

<div class="space-y-4">
  <div class="card p-4">
    <TopAthletes {data} />
  </div>

  <div class="card p-4">
    <div class="flex justify-between items-center mb-4">
      <h3>{$_('page.stats.topTrainers')}</h3>
      <TrainerDownload {year} {yearmode} />
    </div>
    <TopTrainers {data} />
  </div>

  <div class="card p-4">
    <h3>{$_('page.stats.topParticipants')}</h3>
    <TopParticipantsStats {yearmode} {year} />
  </div>

  <div class="card p-4">
    <TopEventParticipants {yearmode} {year} />
  </div>
  <div class="card p-4">
    <TopEventCoaches {yearmode} {year} />
  </div>
</div>
