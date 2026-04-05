<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faGripLines } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';

  let { data }: { data: PageData } = $props();
</script>

<h1 class="mb-4">{$_('page.trainings.title')}</h1>
<ul class="flex flex-col gap-2">
  {#each data.trainings as t, index (t.id)}
    {#if index === 0 || t.weekday !== data.trainings[index - 1].weekday}
      <h3 class="text-lg font-semibold mt-4 mb-1">{$_('weekday.' + t.weekday)}</h3>
    {/if}
    <li class="flex items-center gap-3 py-2">
      <div
        class="size-10 rounded-md bg-surface-100-900 flex items-center justify-center text-sm font-bold flex-shrink-0"
      >
        {t.title.charAt(0)}{t.title.charAt(1)}
      </div>
      <span class="flex-auto min-w-0">
        <dt class="font-bold truncate">{t.title}</dt>
        <dd class="text-sm text-surface-600-400">
          {$_('weekday.' + t.weekday)} - {t.dateFrom} | {t.section}
        </dd>
      </span>
      <a class="btn btn-sm preset-tonal-primary flex-shrink-0" href="/dashboard/trainings/{t.id}">
        <Fa icon={faGripLines} />
        <span class="hidden sm:inline">{$_('button.view')}</span>
      </a>
    </li>
  {/each}
</ul>
