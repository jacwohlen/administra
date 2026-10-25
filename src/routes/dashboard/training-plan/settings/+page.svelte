<script lang="ts">
  import { onMount } from 'svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import AssistantButton from '$lib/components/assistant/AssistantButton.svelte';
  import AssistantDialog from '$lib/components/assistant/AssistantDialog.svelte';
  import TrainingPlanReview from './TrainingPlanReview.svelte';
  import { takeAssistantRequest } from '$lib/assistant/autoOpen';
  import { loadAssistantStatus } from '$lib/assistant/client';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faDoorClosed,
    faPlus,
    faTrash,
    faUmbrellaBeach
  } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import { invalidate } from '$app/navigation';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import type { TrainingPlanBreak } from '$lib/models';
  import ImportSheet from './ImportSheet.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let busy = $state(false);
  let confirmRemove = $state<TrainingPlanBreak | null>(null);
  let form = $state({ title: '', date_from: '', date_to: '', cancels_training: false });
  let showAssistant = $state(false);
  /** The holidays as the assistant read them again after a partial save, while it is open */
  let assistantBreaks = $state.raw<TrainingPlanBreak[] | null>(null);
  /** The assistant saved something (or tried: a failed write may still commit): reload on close */
  let assistantSaved = false;

  async function refresh() {
    await invalidate('training-plan:settings');
  }

  function closeAssistant() {
    showAssistant = false;
    assistantBreaks = null;
    if (assistantSaved) {
      assistantSaved = false;
      refresh();
    }
  }

  // Opened from the Daten-Assistent overview with ?assistant=training_plan
  onMount(() => {
    if (!takeAssistantRequest('training_plan') || !data.canPlanTrainings) return;
    if (data.plannedTrainings.length === 0) {
      toaster.warning({ title: $_('page.trainingPlan.import.noTrainings') });
      return;
    }
    loadAssistantStatus().then((s) => (showAssistant = s.configured));
  });

  async function toggleTraining(id: number, planned: boolean) {
    busy = true;
    const { error } = planned
      ? await supabaseClient.from('training_plan_trainings').insert({ training_id: id })
      : await supabaseClient.from('training_plan_trainings').delete().eq('training_id', id);
    busy = false;
    if (error) {
      console.error('Error changing planned trainings:', error);
      toaster.error({ title: $_('page.trainingPlan.saveError') });
    }
    await refresh();
  }

  async function addBreak() {
    const title = form.title.trim();
    const date_to = form.date_to || form.date_from;
    if (!title || !form.date_from || date_to < form.date_from) {
      toaster.error({ title: $_('page.trainingPlan.settings.breakInvalid') });
      return;
    }
    busy = true;
    const { error } = await supabaseClient.from('training_plan_breaks').insert({
      title,
      date_from: form.date_from,
      date_to,
      cancels_training: form.cancels_training
    });
    busy = false;
    if (error) {
      console.error('Error adding break:', error);
      toaster.error({ title: $_('page.trainingPlan.saveError') });
      return;
    }
    form = { title: '', date_from: '', date_to: '', cancels_training: false };
    await refresh();
  }

  async function setClosed(b: TrainingPlanBreak, cancels_training: boolean) {
    busy = true;
    const { error } = await supabaseClient
      .from('training_plan_breaks')
      .update({ cancels_training })
      .eq('id', b.id);
    busy = false;
    if (error) {
      console.error('Error changing break:', error);
      toaster.error({ title: $_('page.trainingPlan.saveError') });
    }
    await refresh();
  }

  async function removeBreak(b: TrainingPlanBreak) {
    confirmRemove = null;
    busy = true;
    const { error } = await supabaseClient.from('training_plan_breaks').delete().eq('id', b.id);
    busy = false;
    if (error) {
      console.error('Error deleting break:', error);
      toaster.error({ title: $_('page.trainingPlan.saveError') });
    }
    await refresh();
  }

  function range(b: TrainingPlanBreak) {
    const to = dayjs(b.date_to).format('DD.MM.YYYY');
    return b.date_from === b.date_to ? to : `${dayjs(b.date_from).format('DD.MM.YYYY')} – ${to}`;
  }
</script>

<div class="page-header-back">
  <a
    href="/dashboard/training-plan"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.trainingPlan.title')}
    aria-label={$_('page.trainingPlan.title')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{$_('page.trainingPlan.settings.title')}</h1>
</div>

<section class="mb-8">
  <h3>{$_('page.trainingPlan.settings.trainings')}</h3>
  <p class="text-sm text-surface-600-400 mb-2">{$_('page.trainingPlan.settings.trainingsHint')}</p>
  <ul class="card border border-surface-200-800 divide-y divide-surface-200-800">
    {#each data.trainings as t (t.id)}
      <li>
        <label class="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
          <input
            class="checkbox"
            type="checkbox"
            checked={data.plannedIds.includes(Number(t.id))}
            disabled={busy}
            onchange={(e) => toggleTraining(Number(t.id), (e.target as HTMLInputElement).checked)}
          />
          <span class="w-8 text-sm text-surface-600-400">{$_('weekdayShort.' + t.weekday)}</span>
          <span class="w-12 text-sm tabular-nums">{t.dateFrom}</span>
          <span class="flex-1 truncate font-semibold">{t.title}</span>
          <span class="text-sm text-surface-600-400 flex-none">{t.section}</span>
        </label>
      </li>
    {/each}
  </ul>
</section>

<section>
  <h3>{$_('page.trainingPlan.settings.breaks')}</h3>
  <p class="text-sm text-surface-600-400 mb-2">{$_('page.trainingPlan.settings.breaksHint')}</p>

  <form
    class="card border border-surface-200-800 p-3 mb-3 grid grid-cols-2 sm:grid-cols-[1fr_auto_auto] gap-2 items-end"
    onsubmit={(e) => {
      e.preventDefault();
      addBreak();
    }}
  >
    <label class="label col-span-2 sm:col-span-1">
      <span>{$_('page.trainingPlan.settings.breakTitle')}</span>
      <input
        class="input"
        type="text"
        placeholder={$_('page.trainingPlan.settings.breakTitlePlaceholder')}
        bind:value={form.title}
        required
      />
    </label>
    <label class="label">
      <span>{$_('page.trainingPlan.from')}</span>
      <input class="input" type="date" bind:value={form.date_from} required />
    </label>
    <label class="label">
      <span>{$_('page.trainingPlan.to')}</span>
      <input class="input" type="date" bind:value={form.date_to} min={form.date_from} />
    </label>
    <label class="flex items-center gap-2 col-span-2 sm:col-span-3">
      <input class="checkbox" type="checkbox" bind:checked={form.cancels_training} />
      <span>{$_('page.trainingPlan.settings.closed')}</span>
    </label>
    <button
      type="submit"
      class="btn preset-filled-primary-500 col-span-2 sm:col-span-3 sm:justify-self-end"
      disabled={busy}
    >
      <Fa icon={faPlus} />
      <span>{$_('button.add')}</span>
    </button>
  </form>

  {#if data.breaks.length === 0}
    <div class="empty-state"><p>{$_('page.trainingPlan.settings.noBreaks')}</p></div>
  {:else}
    <ul class="card border border-surface-200-800 divide-y divide-surface-200-800">
      {#each data.breaks as b (b.id)}
        <li class="flex items-center gap-3 px-3 py-2">
          <div
            class="entity-badge {b.cancels_training
              ? 'bg-warning-500/20! text-warning-800-200'
              : 'text-surface-600-400'}"
          >
            <Fa icon={b.cancels_training ? faDoorClosed : faUmbrellaBeach} size="lg" />
          </div>
          <div class="list-item-content">
            <div class="font-semibold truncate">{b.title}</div>
            <div class="text-sm text-surface-600-400 tabular-nums">{range(b)}</div>
          </div>
          <label class="flex items-center gap-1.5 min-h-11 text-sm flex-none cursor-pointer">
            <input
              class="checkbox"
              type="checkbox"
              checked={b.cancels_training}
              disabled={busy}
              onchange={(e) => setClosed(b, (e.target as HTMLInputElement).checked)}
            />
            <span>{$_('page.trainingPlan.settings.closedShort')}</span>
          </label>
          <button
            class="btn-icon size-11 p-0 flex-none text-error-600-400 hover:preset-tonal-error"
            onclick={() => (confirmRemove = b)}
            disabled={busy}
            title={$_('button.delete')}
            aria-label="{$_('button.delete')}: {b.title}"
          >
            <Fa icon={faTrash} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mt-8">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3>{$_('page.trainingPlan.import.title')}</h3>
    {#if data.canPlanTrainings && data.plannedTrainings.length > 0}
      <AssistantButton
        class="btn preset-tonal-primary text-sm"
        label={$_('assistant.kinds.training_plan.title')}
        onclick={() => (showAssistant = true)}
      />
    {/if}
  </div>
  <ImportSheet
    trainings={data.plannedTrainings}
    members={data.members}
    breaks={data.breaks}
    onimported={refresh}
  />
</section>

{#if showAssistant && data.canPlanTrainings}
  <AssistantDialog kind="training_plan" onclose={closeAssistant}>
    {#snippet review(proposal, back)}
      <TrainingPlanReview
        {proposal}
        trainings={data.plannedTrainings}
        members={data.members}
        breaks={assistantBreaks ?? data.breaks}
        onback={back}
        oncancel={closeAssistant}
        onapplied={() => {
          assistantSaved = true;
          closeAssistant();
        }}
        onpartial={(breaks) => {
          // The review stays open; a new reading compares against these
          assistantBreaks = breaks;
          assistantSaved = true;
        }}
      />
    {/snippet}
  </AssistantDialog>
{/if}

{#if confirmRemove}
  {@const b = confirmRemove}
  <ConfirmDialog
    title={$_('dialog.confirm.title')}
    message={$_('page.trainingPlan.settings.breakDeleteConfirm', { values: { title: b.title } })}
    confirmLabel={$_('button.delete')}
    oncancel={() => (confirmRemove = null)}
    onconfirm={() => removeBreak(b)}
  />
{/if}
