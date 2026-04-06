<script lang="ts">
  import type { Athletes } from '$lib/models';
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import TopList from './TopList.svelte';

  let { data }: { data: PageData } = $props();

  let topAthletes = $derived(data.topAthletes as { [key: string]: Athletes[] });
</script>

<h3>{$_('page.stats.topAthletes')}</h3>
<div class="gap-4 justify-start flex flex-col md:flex-row">
  {#each Object.keys(topAthletes) as section}
    <TopList
      {section}
      year={data.yearmode === 'ALL' ? 'ALL' : data.year.toString()}
      category="athletes"
      athletes={topAthletes}
    />
  {/each}
</div>
