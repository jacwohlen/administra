<script lang="ts">
  import Fa from 'svelte-fa';
  import { faGripLines } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import type { Log } from '$lib/models';

  let { logs }: { logs: Promise<Log[]> } = $props();
  let currentItem = $state(10);

  // Reset currentItem when logs changes
  $effect(() => {
    void logs;
    currentItem = 10;
  });
</script>

<h3>{$_('page.members.trainingsHistory.title')}</h3>
{#await logs}
  <div class="space-y-4">
    <div class="placeholder" />
    <div class="grid grid-cols-3 gap-8">
      <div class="placeholder" />
      <div class="placeholder" />
      <div class="placeholder" />
    </div>
    <div class="grid grid-cols-4 gap-4">
      <div class="placeholder" />
      <div class="placeholder" />
      <div class="placeholder" />
      <div class="placeholder" />
    </div>
  </div>
{:then l}
  <ul class="flex flex-col">
    {#each l.slice(0, currentItem) as i}
      <li class="flex items-center gap-3 py-2">
        <span class="flex-auto truncate">
          <dt class="font-semibold">{i.date}</dt>
          <dd class="text-sm text-surface-600-400">{i.trainingId.title}</dd>
        </span>
        <span class="chip preset-tonal-secondary text-sm">{i.trainingId.section}</span>
        <a class="btn preset-tonal-primary" href="/dashboard/trainings/{i.trainingId.id}/{i.date}">
          <Fa icon={faGripLines} />
          <span>{$_('button.view')}</span>
        </a>
      </li>
    {:else}
      <span class="flex justify-center text-surface-600-400 py-4">
        {$_('page.members.trainingsHistory.noItems')}
      </span>
    {/each}
  </ul>
  {#if currentItem < l.length}
    <span class="flex justify-center mt-3">
      <button class="btn preset-tonal-primary" onclick={() => (currentItem = currentItem + 10)}>
        {$_('button.loadMore')}
      </button>
    </span>
  {/if}
{:catch err}
  {err}
{/await}
