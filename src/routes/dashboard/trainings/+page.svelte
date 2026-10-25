<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faChevronRight, faPlus } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';

  let { data }: { data: PageData } = $props();
</script>

<div class="page-header">
  <h1>{$_('page.trainings.title')}</h1>
  {#if data.canWrite}
    <a href="/dashboard/trainings/new" class="btn preset-filled-primary-500">
      <Fa icon={faPlus} />
      <span>{$_('page.trainings.create_training')}</span>
    </a>
  {/if}
</div>
{#if data.trainings.length === 0}
  <p class="empty-state">{$_('page.trainings.empty')}</p>
{/if}
<ul class="flex flex-col gap-2">
  {#each data.trainings as t, index (t.id)}
    {#if index === 0 || t.weekday !== data.trainings[index - 1].weekday}
      <h3 class="mt-4 mb-1">{$_('weekday.' + t.weekday)}</h3>
    {/if}
    <li>
      <a href="/dashboard/trainings/{t.id}" class="list-item list-item-link">
        <div class="entity-badge">
          {t.title.charAt(0)}{t.title.charAt(1)}
        </div>
        <span class="list-item-content">
          <dt class="font-bold truncate">{t.title}</dt>
          <dd class="text-sm text-surface-600-400">
            {$_('weekday.' + t.weekday)} - {t.dateFrom} | {t.section}
          </dd>
        </span>
        <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
      </a>
    </li>
  {/each}
</ul>
