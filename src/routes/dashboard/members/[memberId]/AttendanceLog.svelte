<script lang="ts">
  import Fa from 'svelte-fa';
  import { faGripLines } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import type { Log } from '$lib/models';

  export let logs: Promise<Log[]>;
  let currentItem = 10;

  // Function to be called when logs is set or changed
  async function handleLogsChange() {
    currentItem = 10; // Reset currentItem when logs changes
  }

  // Reactively call handleLogsChange whenever logs is updated
  $: (logs, handleLogsChange());
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
  <ul class="list">
    {#each l.slice(0, currentItem) as i}
      <li>
        <span class="flex-auto truncate">
          <dt>
            {i.date}
          </dt>
          <dd class="text-sm">{i.trainingId.title}</dd>
        </span>
        <span class="text-sm">
          {i.trainingId.section}
        </span>
        <span>
          <a
            class="btn btn-sm variant-filled-secondary"
            href="/dashboard/trainings/{i.trainingId.id}/{i.date}"
          >
            <Fa icon={faGripLines} />
            <span>{$_('button.view')}</span>
          </a>
        </span>
      </li>
    {:else}
      <span class="flex justify-center">
        {$_('page.members.trainingsHistory.noItems')}
      </span>
    {/each}
  </ul>
  {#if currentItem < l.length}
    <span class="flex justify-center">
      <button
        class="btn btn-sm variant-filled-secondary"
        on:click={() => (currentItem = currentItem + 10)}
      >
        {$_('button.loadMore')}
      </button>
    </span>
  {/if}
{:catch err}
  {err}
{/await}
