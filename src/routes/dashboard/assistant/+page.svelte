<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowRight,
    faAward,
    faCalendarDays,
    faClipboardList,
    faListCheck,
    faShieldHalved,
    faTableList,
    faTriangleExclamation,
    faWandMagicSparkles
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { loadAssistantStatus } from '$lib/assistant/client';
  import { assistantHref } from '$lib/assistant/autoOpen';
  import type { AssistantKind, AssistantStatus } from '$lib/assistant/types';
  import utils from '$lib/utils';
  import type { PageData } from './$types';

  /**
   * Overview of the Daten-Assistent (docs/AI_ASSISTANT.md). Each kind is
   * reviewed and saved on the page it belongs to; this page picks the
   * member or training and sends the user there with ?assistant=<kind>,
   * which opens the dialog on arrival.
   */
  let { data }: { data: PageData } = $props();

  let status = $state<AssistantStatus | null>(null);
  loadAssistantStatus().then((s) => (status = s));

  interface Hit {
    id: number;
    firstname: string;
    lastname: string;
  }
  let memberTerm = $state('');
  let hits = $state<Hit[]>([]);
  let searchRun = 0;

  async function searchMembers() {
    const term = memberTerm.trim();
    const run = ++searchRun;
    if (term.length < 2) {
      hits = [];
      return;
    }
    const { data: rows } = await supabaseClient
      .from('view_search_members')
      .select('id, firstname, lastname')
      .ilike('fullname', `%${term.replace(/[\\%_]/g, '\\$&')}%`)
      .order('lastname')
      .limit(20);
    if (run === searchRun) hits = (rows ?? []) as Hit[];
  }

  let trainingId = $state('');
  let date = $state('');
  const training = $derived(data.trainings.find((t) => String(t.id) === trainingId));

  function pickTraining(id: string) {
    trainingId = id;
    const t = data.trainings.find((x) => String(x.id) === id);
    date = t
      ? utils.getMostRecentDateByWeekday(utils.weekdayToNumber(t.weekday)).format('YYYY-MM-DD')
      : '';
  }

  function openForTraining(kind: AssistantKind) {
    if (!training || !date) return;
    goto(assistantHref(`/dashboard/trainings/${training.id}/${date}`, kind));
  }

  const ready = $derived(status?.configured === true);
</script>

<div class="page-header">
  <h1 class="flex items-center gap-2">
    <Fa icon={faWandMagicSparkles} class="text-primary-500" />
    <span>{$_('assistant.title')}</span>
  </h1>
</div>

<section class="card p-4 space-y-3 mb-4">
  <p>{$_('assistant.page.intro')}</p>
  <ol class="list-decimal pl-5 space-y-1 text-sm">
    <li>{$_('assistant.page.step1')}</li>
    <li>{$_('assistant.page.step2')}</li>
    <li>{$_('assistant.page.step3')}</li>
    <li>{$_('assistant.page.step4')}</li>
  </ol>
  <p class="flex items-start gap-2 text-sm text-surface-600-400">
    <Fa icon={faShieldHalved} class="mt-0.5 flex-none" />
    <span>{$_('assistant.page.safety')}</span>
  </p>
</section>

{#if status && !status.configured}
  <div
    class="flex items-start gap-2 p-3 mb-4 rounded-lg preset-tonal-warning text-sm"
    role="status"
  >
    <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
    <span>{$_('assistant.page.notConfigured')}</span>
  </div>
{:else if status?.remaining != null}
  <p class="mb-4 text-sm text-surface-600-400">
    {$_('assistant.remaining', { values: { count: status.remaining } })}
  </p>
{/if}

<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
  {#if data.canWrite}
    <section class="card p-4 space-y-3">
      <h2 class="h4 flex items-center gap-2">
        <Fa icon={faAward} />
        <span>{$_('assistant.kinds.grades.title')}</span>
      </h2>
      <p class="text-sm text-surface-600-400">{$_('assistant.kinds.grades.description')}</p>
      <label class="label">
        <span>{$_('assistant.page.member')}</span>
        <input
          class="input"
          type="search"
          autocomplete="off"
          placeholder={$_('assistant.page.memberPlaceholder')}
          disabled={!ready}
          bind:value={memberTerm}
          oninput={searchMembers}
        />
      </label>
      {#if hits.length > 0}
        <ul class="space-y-1">
          {#each hits as hit (hit.id)}
            <li>
              <a
                class="btn preset-tonal-surface w-full justify-between"
                href={assistantHref(`/dashboard/members/${hit.id}`, 'grades')}
              >
                <span>{hit.lastname} {hit.firstname}</span>
                <Fa icon={faArrowRight} />
              </a>
            </li>
          {/each}
        </ul>
      {:else if memberTerm.trim().length >= 2}
        <p class="text-sm text-surface-600-400">{$_('assistant.review.noMatch')}</p>
      {/if}
    </section>

    <section class="card p-4 space-y-3">
      <h2 class="h4 flex items-center gap-2">
        <Fa icon={faListCheck} />
        <span>
          {$_('assistant.kinds.attendance.title')} · {$_('assistant.kinds.lesson_plan.title')}
        </span>
      </h2>
      <p class="text-sm text-surface-600-400">{$_('assistant.kinds.attendance.description')}</p>
      <p class="text-sm text-surface-600-400">{$_('assistant.kinds.lesson_plan.description')}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label class="label">
          <span>{$_('assistant.page.training')}</span>
          <select
            class="select"
            disabled={!ready}
            value={trainingId}
            onchange={(e) => pickTraining(e.currentTarget.value)}
          >
            <option value="">{$_('assistant.page.trainingPlaceholder')}</option>
            {#each data.trainings as t (t.id)}
              <option value={String(t.id)}>
                {$_('weekdayShort.' + t.weekday)}
                {t.dateFrom} · {t.title}
              </option>
            {/each}
          </select>
        </label>
        <label class="label">
          <span>{$_('assistant.page.date')}</span>
          <input class="input" type="date" disabled={!ready || !training} bind:value={date} />
        </label>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn preset-filled-primary-500"
          disabled={!ready || !training || !date}
          onclick={() => openForTraining('attendance')}
        >
          <Fa icon={faClipboardList} />
          <span>{$_('assistant.kinds.attendance.title')}</span>
        </button>
        <button
          type="button"
          class="btn preset-tonal-primary"
          disabled={!ready || !training || !date}
          onclick={() => openForTraining('lesson_plan')}
        >
          <Fa icon={faTableList} />
          <span>{$_('assistant.kinds.lesson_plan.title')}</span>
        </button>
      </div>
    </section>
  {/if}

  {#if data.canPlanTrainings}
    <section class="card p-4 space-y-3">
      <h2 class="h4 flex items-center gap-2">
        <Fa icon={faTableList} />
        <span>{$_('assistant.kinds.training_plan.title')}</span>
      </h2>
      <p class="text-sm text-surface-600-400">
        {$_('assistant.kinds.training_plan.description')}
      </p>
      {#if ready}
        <a
          class="btn preset-filled-primary-500"
          href={assistantHref('/dashboard/training-plan/settings', 'training_plan')}
        >
          <span>{$_('assistant.page.start')}</span>
          <Fa icon={faArrowRight} />
        </a>
      {/if}
    </section>
  {/if}

  {#if data.canWrite}
    <section class="card p-4 space-y-3">
      <h2 class="h4 flex items-center gap-2">
        <Fa icon={faCalendarDays} />
        <span>{$_('assistant.kinds.events.title')}</span>
      </h2>
      <p class="text-sm text-surface-600-400">{$_('assistant.kinds.events.description')}</p>
      {#if ready}
        <a
          class="btn preset-filled-primary-500"
          href={assistantHref('/dashboard/events', 'events')}
        >
          <span>{$_('assistant.page.start')}</span>
          <Fa icon={faArrowRight} />
        </a>
      {/if}
    </section>
  {/if}
</div>
