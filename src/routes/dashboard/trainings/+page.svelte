<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faGripLines } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';

  let { data }: { data: PageData } = $props();
</script>

<h1>{$_('page.trainings.title')}</h1>
<ul class="list">
  {#each data.trainings as t, index (t.id)}
    {#if index > 0}
      {#if t.weekday != data.trainings[index - 1].weekday}
        <div class="relative flex pt-4 justify-center">
          <span class="flex-shrink mx-4 text-gray-400">{$_('weekday.' + t.weekday)}</span>
        </div>
      {/if}
    {:else}
      <div class="relative flex pt-4 justify-center">
        <span class="flex-shrink mx-4 text-gray-400">{$_('weekday.' + t.weekday)}</span>
      </div>
    {/if}
    <li>
      <span class="flex-auto">
        <dt class="font-bold">
          {t.title}
        </dt>
        <dd class="text-sm">{$_('weekday.' + t.weekday)} - {t.dateFrom} | {t.section}</dd>
      </span>
      <span>
        <a class="btn btn-sm preset-filled-secondary-500" href="/dashboard/trainings/{t.id}">
          <Fa icon={faGripLines} />
          <span>{$_('button.view')}</span>
        </a>
      </span>
    </li>
  {/each}
</ul>
