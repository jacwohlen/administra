<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowLeft, faPlus, faTrash, faUmbrellaBeach } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import { invalidate } from '$app/navigation';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import type { TrainingPlanBreak } from '$lib/models';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let busy = $state(false);
  let form = $state({ title: '', date_from: '', date_to: '' });

  async function refresh() {
    await invalidate('training-plan:settings');
  }

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
    const { error } = await supabaseClient
      .from('training_plan_breaks')
      .insert({ title, date_from: form.date_from, date_to });
    busy = false;
    if (error) {
      console.error('Error adding break:', error);
      toaster.error({ title: $_('page.trainingPlan.saveError') });
      return;
    }
    form = { title: '', date_from: '', date_to: '' };
    await refresh();
  }

  async function removeBreak(b: TrainingPlanBreak) {
    if (
      !confirm($_('page.trainingPlan.settings.breakDeleteConfirm', { values: { title: b.title } }))
    )
      return;
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

<div class="page-header gap-2">
  <a href="/dashboard/training-plan" class="btn preset-tonal-surface">
    <Fa icon={faArrowLeft} />
    <span class="hidden sm:inline">{$_('page.trainingPlan.title')}</span>
  </a>
  <h1 class="truncate">{$_('page.trainingPlan.settings.title')}</h1>
</div>

<section class="mb-8">
  <h3>{$_('page.trainingPlan.settings.trainings')}</h3>
  <p class="text-sm text-surface-600-400 mb-2">{$_('page.trainingPlan.settings.trainingsHint')}</p>
  <ul class="card border border-surface-200-800 divide-y divide-surface-200-800">
    {#each data.trainings as t (t.id)}
      <li>
        <label class="flex items-center gap-3 px-3 py-2 cursor-pointer">
          <input
            class="checkbox"
            type="checkbox"
            checked={data.plannedIds.includes(Number(t.id))}
            disabled={busy}
            onchange={(e) => toggleTraining(Number(t.id), (e.target as HTMLInputElement).checked)}
          />
          <span class="w-8 text-sm text-surface-600-400">{$_('weekdayShort.' + t.weekday)}</span>
          <span class="w-12 text-sm">{t.dateFrom}</span>
          <span class="flex-1 truncate font-semibold">{t.title}</span>
          <span class="text-sm text-surface-600-400">{t.section}</span>
        </label>
      </li>
    {/each}
  </ul>
</section>

<section>
  <h3>{$_('page.trainingPlan.settings.breaks')}</h3>
  <p class="text-sm text-surface-600-400 mb-2">{$_('page.trainingPlan.settings.breaksHint')}</p>

  <form
    class="card border border-surface-200-800 p-3 mb-3 grid grid-cols-2 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end"
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
    <button
      type="submit"
      class="btn preset-filled-primary-500 col-span-2 sm:col-span-1"
      disabled={busy}
    >
      <Fa icon={faPlus} />
      <span>{$_('button.add')}</span>
    </button>
  </form>

  {#if data.breaks.length === 0}
    <div class="empty-state"><p>{$_('page.trainingPlan.settings.noBreaks')}</p></div>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.breaks as b (b.id)}
        <li class="list-item">
          <div class="entity-badge text-warning-600-400">
            <Fa icon={faUmbrellaBeach} />
          </div>
          <div class="list-item-content">
            <div class="font-semibold truncate">{b.title}</div>
            <div class="text-sm text-surface-600-400">{range(b)}</div>
          </div>
          <button
            class="btn-icon preset-tonal-error flex-none"
            onclick={() => removeBreak(b)}
            disabled={busy}
            aria-label="{$_('button.delete')}: {b.title}"
          >
            <Fa icon={faTrash} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
