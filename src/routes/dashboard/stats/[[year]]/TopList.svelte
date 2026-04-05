<script lang="ts">
  import type { Athletes } from '$lib/models';
  import { supabaseClient } from '$lib/supabase';
  import { faAngleRight } from '@fortawesome/free-solid-svg-icons';
  import { Avatar } from '@skeletonlabs/skeleton-svelte';
  import Fa from 'svelte-fa';

  let {
    year,
    category,
    section,
    athletes
  }: {
    year: string;
    category: string;
    section: string;
    athletes: { [key: string]: Athletes[] };
  } = $props();

  async function getImage(id: number) {
    const { error, data } = await supabaseClient
      .from('members')
      .select('img')
      .eq('id', id)
      .single();

    if (error) {
      return null;
    }

    return data.img;
  }
</script>

<div class="card p-4 pt-2 pb-4 min-w-72">
  <div class="flex justify-between">
    <h3 class="indent-2">{section}</h3>
    <a class="btn btn-sm" href={'/dashboard/stats/' + year + '/top/' + category + '/' + section}>
      <Fa icon={faAngleRight} />
    </a>
  </div>
  <div class="grid grid-cols-3 gap-4">
    <div class="text-center mt-4">
      {#if athletes[section][1] != undefined}
        <div class="relative inline-block">
          <span class="badge-icon absolute -top-0 -right-0 z-10 bg-surface-300">2</span>
          {#await getImage(athletes[section][1].memberId)}
            <Avatar class="mx-auto size-16 border-4 border-surface-300">
              <Avatar.Fallback
                >{athletes[section][1].firstname.charAt(0)}{athletes[section][1].lastname.charAt(
                  0
                )}</Avatar.Fallback
              >
            </Avatar>
          {:then img}
            <Avatar class="mx-auto size-16 border-4 border-surface-300">
              {#if img}
                <Avatar.Image
                  src={img}
                  alt="{athletes[section][1].firstname} {athletes[section][1].lastname}"
                />
              {/if}
              <Avatar.Fallback
                >{athletes[section][1].firstname.charAt(0)}{athletes[section][1].lastname.charAt(
                  0
                )}</Avatar.Fallback
              >
            </Avatar>
          {/await}
        </div>
        <div>
          <p class="text-center">
            {athletes[section][1].firstname}
            {athletes[section][1].lastname}
            ({athletes[section][1].count})
          </p>
        </div>
      {:else}
        <div class="w-full" />
      {/if}
    </div>
    <div class="text-center">
      {#if athletes[section][0] != undefined}
        <div class="relative inline-block">
          <span class="badge-icon absolute -top-0 -right-0 z-10 bg-yellow-500">1</span>
          {#await getImage(athletes[section][0].memberId)}
            <Avatar class="mx-auto size-20 border-4 border-yellow-500">
              <Avatar.Fallback
                >{athletes[section][0].firstname.charAt(0)}{athletes[section][0].lastname.charAt(
                  0
                )}</Avatar.Fallback
              >
            </Avatar>
          {:then img}
            <Avatar class="mx-auto size-20 border-4 border-yellow-500">
              {#if img}
                <Avatar.Image
                  src={img}
                  alt="{athletes[section][0].firstname} {athletes[section][0].lastname}"
                />
              {/if}
              <Avatar.Fallback
                >{athletes[section][0].firstname.charAt(0)}{athletes[section][0].lastname.charAt(
                  0
                )}</Avatar.Fallback
              >
            </Avatar>
          {/await}
        </div>
        <div>
          <p class="text-center">
            {athletes[section][0].firstname}
            {athletes[section][0].lastname}
            ({athletes[section][0].count})
          </p>
        </div>
      {:else}
        <div class="w-full" />
      {/if}
    </div>
    <div class="text-center mt-4">
      {#if athletes[section][2] != undefined}
        <div class="relative inline-block">
          <span class="badge-icon absolute -top-0 -right-0 z-10 bg-amber-700">3</span>
          {#await getImage(athletes[section][2].memberId)}
            <Avatar class="mx-auto size-16 border-4 border-amber-700">
              <Avatar.Fallback
                >{athletes[section][2].firstname.charAt(0)}{athletes[section][2].lastname.charAt(
                  0
                )}</Avatar.Fallback
              >
            </Avatar>
          {:then img}
            <Avatar class="mx-auto size-16 border-4 border-amber-700">
              {#if img}
                <Avatar.Image
                  src={img}
                  alt="{athletes[section][2].firstname} {athletes[section][2].lastname}"
                />
              {/if}
              <Avatar.Fallback
                >{athletes[section][2].firstname.charAt(0)}{athletes[section][2].lastname.charAt(
                  0
                )}</Avatar.Fallback
              >
            </Avatar>
          {/await}
        </div>
        <div>
          <p class="text-center">
            {athletes[section][2].firstname}
            {athletes[section][2].lastname}
            ({athletes[section][2].count})
          </p>
        </div>
      {:else}
        <div class="w-full" />
      {/if}
    </div>
  </div>
  <hr class="my-2" />
  <div class="overflow-y-auto w-full mr-2">
    <ol class="list-decimal list-inside mr-2" start="4">
      {#each athletes[section].slice(3, 10) as item}
        <li class="py-1">
          <span class="text-nowrap">{item.lastname} {item.firstname} ({item.count})</span>
        </li>
      {/each}
    </ol>
  </div>
</div>
