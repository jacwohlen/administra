<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faAward,
    faBookOpen,
    faCalendarDays,
    faChevronRight,
    faGripLines,
    faPlus,
    faUsers
  } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import { candidateState } from '$lib/examUtils';
  import type { ExamListEntry } from './+page';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const today = dayjs().format('YYYY-MM-DD');

  let upcoming = $derived(
    data.exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  );
  let past = $derived(data.exams.filter((e) => e.date < today));

  function counts(exam: ExamListEntry) {
    const states = exam.candidates.map(candidateState);
    return {
      registered: states.filter((s) => s !== 'withdrawn').length,
      passed: states.filter((s) => s === 'passed').length
    };
  }
</script>

<div class="page-header gap-2">
  <h1 class="whitespace-nowrap">{$_('page.exams.title')}</h1>
  {#if data.canWrite}
    <a href="/dashboard/exams/new" class="btn preset-filled-primary-500 flex-shrink-0">
      <Fa icon={faPlus} />
      <span>{$_('page.exams.create')}</span>
    </a>
  {/if}
</div>

<p class="text-sm text-surface-600-400 mb-4">{$_('page.exams.intro')}</p>

<a
  href="/dashboard/exams/programs"
  class="card border border-surface-200-800 flex items-center gap-3 px-3 py-2.5 mb-6 hover:bg-surface-100-900 transition-colors"
>
  <div class="entity-badge text-primary-600-400">
    <Fa icon={faBookOpen} size="lg" />
  </div>
  <div class="flex-1 min-w-0">
    <p class="font-semibold truncate">{$_('page.exams.programs.title')}</p>
    <p class="text-sm text-surface-600-400 truncate">{$_('page.exams.programs.short')}</p>
  </div>
  <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
</a>

{#snippet examList(exams: ExamListEntry[])}
  <ul class="flex flex-col gap-2">
    {#each exams as exam (exam.id)}
      {@const c = counts(exam)}
      <li class="list-item">
        <div class="entity-badge text-primary-600-400">
          <Fa icon={faAward} size="lg" />
        </div>
        <a href="/dashboard/exams/{exam.id}" class="list-item-content">
          <div class="font-bold truncate">{exam.title}</div>
          <div class="flex flex-wrap items-center gap-x-3 text-sm text-surface-600-400">
            <span class="meta-item">
              <Fa icon={faCalendarDays} size="sm" />
              {dayjs(exam.date).format('DD.MM.YYYY')}
            </span>
            <span>{exam.section}</span>
            <span class="meta-item">
              <Fa icon={faUsers} size="sm" />
              {$_('page.exams.candidateCount', { values: { count: c.registered } })}
            </span>
            {#if c.passed > 0}
              <span>{$_('page.exams.passedCount', { values: { count: c.passed } })}</span>
            {/if}
          </div>
        </a>
        <a class="btn preset-tonal-primary flex-none" href="/dashboard/exams/{exam.id}">
          <Fa icon={faGripLines} />
          <span class="hidden sm:inline">{$_('button.view')}</span>
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

{#if data.exams.length === 0}
  <div class="empty-state">
    <p>{$_('page.exams.empty')}</p>
  </div>
{:else}
  <div class="space-y-6">
    {#if upcoming.length > 0}
      <section>
        <h3>{$_('page.exams.upcoming')}</h3>
        {@render examList(upcoming)}
      </section>
    {/if}
    {#if past.length > 0}
      <section>
        <h3>{$_('page.exams.past')}</h3>
        {@render examList(past)}
      </section>
    {/if}
  </div>
{/if}
