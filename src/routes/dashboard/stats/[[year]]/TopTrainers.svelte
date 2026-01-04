<script lang="ts">
  import { error as err } from '@sveltejs/kit';
  import { type Athletes } from '$lib/models';
  import { supabaseClient } from '$lib/supabase';
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import TopList from './TopList.svelte';

  export let data: PageData;

  async function getTopTrainers(mode: 'YEAR' | 'ALL', y: number | '') {
    if (mode === 'ALL') y = '';
    const { error, data } = await supabaseClient
      .rpc('get_top_trainers_by_section', {
        year: y
      })
      .returns<Athletes[]>();

    if (error) {
      throw err(404, error);
    }

    // Use reduce to group by 'section'
    const groupedData = data.reduce(
      (accumulator: { [key: string]: Athletes[] }, currentItem: Athletes) => {
        // If the section does not exist in the accumulator, create a new array for it
        if (!accumulator[currentItem.section]) {
          accumulator[currentItem.section] = [];
        }

        // Push the current item into the appropriate section
        accumulator[currentItem.section].push(currentItem);

        return accumulator;
      },
      {}
    );

    const orderedData = Object.keys(groupedData)
      .sort() // Sort the keys alphabetically
      .reduce((sortedAccumulator: { [key: string]: Athletes[] }, key: string) => {
        sortedAccumulator[key] = groupedData[key];
        return sortedAccumulator;
      }, {});

    return orderedData as { [key: string]: Athletes[] };
  }
</script>

<div class="gap-4 justify-start flex flex-col md:flex-row">
  {#await getTopTrainers(data.yearmode, data.year)}
    <div class="overflow-y-auto w-full h-72 mx-2">
      <span class="flex gap-2">
        <div class="placeholder animate-pulse my-4 w-20" />
        <div class="placeholder animate-pulse my-4 w-10" />
        <div class="placeholder animate-pulse my-4 w-16" />
        <div class="placeholder animate-pulse my-4 w-44" />
      </span>
      <div class="placeholder animate-pulse my-4" />
      <div class="placeholder animate-pulse my-4" />
      <div class="placeholder animate-pulse my-4" />
    </div>
  {:then topTrainers}
    {#each Object.keys(topTrainers) as section}
      <TopList
        {section}
        year={data.yearmode === 'ALL' ? 'ALL' : data.year.toString()}
        category="trainers"
        athletes={topTrainers}
      />
    {/each}
  {/await}
</div>
