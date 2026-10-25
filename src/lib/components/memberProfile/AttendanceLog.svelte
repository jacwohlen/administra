<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import type { Log } from '$lib/models';
  import { displayConfig } from '$lib/appSettings';

  let { logs }: { logs: Promise<Log[]> } = $props();
  let currentItem = $state(displayConfig.attendanceLogPageSize);

  // Reset currentItem when logs changes
  $effect(() => {
    void logs;
    currentItem = displayConfig.attendanceLogPageSize;
  });
</script>

<h3>{$_('page.members.trainingsHistory.title')}</h3>
{#await logs}
  <div class="space-y-4">
    <div class="placeholder"></div>
    <div class="grid grid-cols-3 gap-8">
      <div class="placeholder"></div>
      <div class="placeholder"></div>
      <div class="placeholder"></div>
    </div>
    <div class="grid grid-cols-4 gap-4">
      <div class="placeholder"></div>
      <div class="placeholder"></div>
      <div class="placeholder"></div>
      <div class="placeholder"></div>
    </div>
  </div>
{:then l}
  <ul class="flex flex-col">
    {#each l.slice(0, currentItem) as i}
      <li>
        <a href="/dashboard/trainings/{i.trainingId.id}/{i.date}" class="list-item list-item-link">
          <span class="flex-auto truncate">
            <dt class="font-semibold">{i.date}</dt>
            <dd class="text-sm text-surface-600-400">{i.trainingId.title}</dd>
          </span>
          <span class="chip preset-tonal-secondary text-sm">{i.trainingId.section}</span>
          <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
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
      <button
        class="btn preset-tonal-primary"
        onclick={() => (currentItem = currentItem + displayConfig.attendanceLogPageSize)}
      >
        {$_('button.loadMore')}
      </button>
    </span>
  {/if}
{:catch err}
  {err}
{/await}
