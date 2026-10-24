<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import {
    faCalendarWeek,
    faChevronRight,
    faGripLines,
    faPlus
  } from '@fortawesome/free-solid-svg-icons';
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

<a
  href="/dashboard/training-plan"
  class="card border border-surface-200-800 flex items-center gap-3 px-3 py-2.5 mb-2 hover:bg-surface-100-900 transition-colors"
>
  <div class="entity-badge text-primary-600-400">
    <Fa icon={faCalendarWeek} size="lg" />
  </div>
  <div class="flex-1 min-w-0">
    <p class="font-semibold truncate">{$_('page.trainingPlan.title')}</p>
    <p class="text-sm text-surface-600-400 truncate">{$_('page.trainingPlan.short')}</p>
  </div>
  <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
</a>

<ul class="flex flex-col gap-2">
  {#each data.trainings as t, index (t.id)}
    {#if index === 0 || t.weekday !== data.trainings[index - 1].weekday}
      <h3 class="mt-4 mb-1">{$_('weekday.' + t.weekday)}</h3>
    {/if}
    <li class="list-item">
      <div class="entity-badge">
        {t.title.charAt(0)}{t.title.charAt(1)}
      </div>
      <span class="list-item-content">
        <dt class="font-bold truncate">{t.title}</dt>
        <dd class="text-sm text-surface-600-400">
          {$_('weekday.' + t.weekday)} - {t.dateFrom} | {t.section}
        </dd>
      </span>
      <a class="btn preset-tonal-primary flex-shrink-0" href="/dashboard/trainings/{t.id}">
        <Fa icon={faGripLines} />
        <span class="hidden sm:inline">{$_('button.view')}</span>
      </a>
    </li>
  {/each}
</ul>
