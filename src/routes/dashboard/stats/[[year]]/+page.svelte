<script lang="ts">
  import TopAthletes from './TopAthletes.svelte';
  import Fa from 'svelte-fa';
  import { faArrowRight, faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import TopParticipantsStats from './TopParticipantsStats.svelte';
  import { RadioGroup, RadioItem } from '@skeletonlabs/skeleton';
  import { _ } from 'svelte-i18n';
  import TopTrainers from './TopTrainers.svelte';
  import TopEventParticipants from './TopEventParticipants.svelte';
  import TopEventCoaches from './TopEventCoaches.svelte';

  export let data: PageData;

  $: yearmode = data.yearmode;
  $: year = data.year;

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
    <button class="btn" on:click={previousYear}>
      <Fa icon={faArrowLeft} /><span>{$_('button.year')}</span>
    </button>
  </div>
  <div>
    <RadioGroup>
      <RadioItem
        bind:group={yearmode}
        on:click={() => goto('/dashboard/stats/' + year)}
        name="yearmode"
        value="YEAR"
      >
        {year}
      </RadioItem>
      <RadioItem
        bind:group={yearmode}
        on:click={() => goto('/dashboard/stats/ALL')}
        name="yearmode"
        value="ALL">{$_('page.stats.all')}</RadioItem
      >
    </RadioGroup>
  </div>
  <div>
    <button class="btn" on:click={nextYear}>
      <span>{$_('button.year')}</span><Fa icon={faArrowRight} />
    </button>
  </div>
</div>

<div class="space-y-4">
  <div class="card p-4">
    <TopAthletes {data} />
  </div>

  <div class="card p-4">
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
