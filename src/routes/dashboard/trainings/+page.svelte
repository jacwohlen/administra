<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faGripLines } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import { Avatar } from '@skeletonlabs/skeleton-svelte';

  let { data }: { data: PageData } = $props();
</script>

<h1>{$_('page.trainings.title')}</h1>
<ul class="flex flex-col gap-1">
  {#each data.trainings as t, index (t.id)}
    {#if index === 0 || t.weekday !== data.trainings[index - 1].weekday}
      <h3 class="text-lg font-semibold mt-4 mb-1">{$_('weekday.' + t.weekday)}</h3>
    {/if}
    <li class="flex items-center gap-3 py-2">
      <Avatar class="rounded-md size-10 flex-shrink-0">
        <Avatar.Fallback>{t.title.charAt(0)}{t.title.charAt(1)}</Avatar.Fallback>
      </Avatar>
      <span class="flex-auto min-w-0">
        <dt class="font-bold truncate">{t.title}</dt>
        <dd class="text-sm text-surface-600-400">
          {$_('weekday.' + t.weekday)} - {t.dateFrom} | {t.section}
        </dd>
      </span>
      <a class="btn btn-sm preset-tonal-primary flex-shrink-0" href="/dashboard/trainings/{t.id}">
        <Fa icon={faGripLines} />
        <span>{$_('button.view')}</span>
      </a>
    </li>
  {/each}
</ul>
