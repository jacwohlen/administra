<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import type { Athletes } from '$lib/models';
  import TopList from './TopList.svelte';

  let { yearmode, year }: { yearmode: 'YEAR' | 'ALL'; year: number } = $props();

  let topEventCoaches: { [key: string]: Athletes[] } = $state({});
  let loading = $state(true);
  let error = $state('');

  async function loadEventCoachStats() {
    loading = true;
    error = '';

    try {
      const yearParam = yearmode === 'ALL' ? null : year.toString();
      const { error: rpcError, data } = await supabaseClient
        .rpc('get_top_event_coaches', {
          year_param: yearParam,
          section_param: null
        })
        .returns<Athletes[]>();

      if (rpcError) {
        error = rpcError.message;
        return;
      }

      // Group by section
      const groupedData = (data || []).reduce(
        (accumulator: { [key: string]: Athletes[] }, currentItem: Athletes) => {
          if (!accumulator[currentItem.section]) {
            accumulator[currentItem.section] = [];
          }
          accumulator[currentItem.section].push(currentItem);
          return accumulator;
        },
        {}
      );

      // Sort sections alphabetically
      topEventCoaches = Object.keys(groupedData)
        .sort()
        .reduce((sortedAccumulator: { [key: string]: Athletes[] }, key: string) => {
          sortedAccumulator[key] = groupedData[key];
          return sortedAccumulator;
        }, {});
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error occurred';
    } finally {
      loading = false;
    }
  }

  // Reload when year or yearmode changes
  $effect(() => {
    if (year || yearmode) {
      loadEventCoachStats();
    }
  });
</script>

<div>
  <h3 class="mb-4">{$_('page.stats.topEventCoaches')}</h3>

  {#if loading}
    <div class="text-center py-4">
      <span class="loading loading-spinner loading-sm"></span>
      <p class="text-sm text-surface-600-400 mt-2">{$_('page.stats.loading')}</p>
    </div>
  {:else if error}
    <div class="flex items-center gap-4 p-4 rounded-lg preset-filled-error-500">
      <div class="flex-1">
        <p>{error}</p>
      </div>
    </div>
  {:else if Object.keys(topEventCoaches).length === 0}
    <div class="text-center py-8">
      <p class="text-surface-600-400">{$_('page.stats.no_event_data')}</p>
    </div>
  {:else}
    <div class="grid gap-4">
      {#each Object.entries(topEventCoaches) as [section]}
        <TopList athletes={topEventCoaches} category="coaches" {section} year={year.toString()} />
      {/each}
    </div>
  {/if}
</div>
