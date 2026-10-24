<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowDown, faArrowUp, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import {
    hasAssignment,
    rotate,
    slotPatch,
    topicLabel,
    type PlanRow,
    type PlanTraining,
    type RotationSlot
  } from '$lib/trainingPlanUtils';
  import TrainerSelect from './TrainerSelect.svelte';
  import type { PlanMember } from './members';

  let {
    trainings,
    rows,
    members,
    topics,
    from,
    to,
    onclose,
    onsaved
  }: {
    trainings: PlanTraining[];
    /** All rows of the shown year */
    rows: PlanRow[];
    members: PlanMember[];
    /** Topics used so far, offered as suggestions */
    topics: string[];
    from: string;
    to: string;
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  /**
   * Trainers: member id, null for "trainer open", 'none' for no training.
   * Topics: the topic, empty for none.
   */
  type SlotForm = { value: number | null | 'keep' | 'none'; topic: string };

  const today = dayjs().format('YYYY-MM-DD');
  // svelte-ignore state_referenced_locally
  let form = $state({
    trainingId: trainings[0]?.id ?? null,
    from: today > from && today < to ? today : from,
    to,
    perSlot: 1,
    skipCancelled: true,
    overwrite: false,
    // Topics: "Seoi-nage, Teil 1", "Seoi-nage, Teil 2" when a topic covers several dates
    numbered: true
  });
  let mode = $state<'trainers' | 'topics'>('trainers');
  let slots = $state<SlotForm[]>([
    { value: null, topic: '' },
    { value: null, topic: '' }
  ]);
  let saving = $state(false);

  let memberName = $derived(
    new Map(members.map((m) => [m.id, `${m.firstname} ${m.lastname}`] as const))
  );

  let rotationSlots = $derived<RotationSlot[]>(
    slots.map(({ value }) =>
      typeof value === 'number'
        ? { kind: 'trainer', memberId: value }
        : value === 'none'
          ? { kind: 'none' }
          : { kind: 'open' }
    )
  );

  let trainingRows = $derived(
    rows.filter(
      (r) => r.training.id === form.trainingId && r.date >= form.from && r.date <= form.to
    )
  );

  // Overwriting trainers starts again from the breaks: a date the last
  // rotation dropped ("no training") counts as held again; held-when-closed
  // stays. Topics leave the cancellations alone.
  let assignments = $derived.by(() => {
    const input = trainingRows.map((r) => ({
      date: r.date,
      cancelled:
        form.overwrite && mode === 'trainers'
          ? r.session?.cancelled === false
            ? false
            : (r.break?.cancels_training ?? false)
          : r.cancelled
    }));
    const byDate = new Map(trainingRows.map((r) => [r.date, r]));
    return rotate(
      input,
      slots.map((_, i) => i),
      { perSlot: form.perSlot, skipCancelled: form.skipCancelled }
    ).map((a) => {
      const row = byDate.get(a.date)!;
      const kept =
        !form.overwrite &&
        (mode === 'trainers' ? hasAssignment(row.session) : !!row.session?.topic);
      const topic = slots[a.slot].topic.trim();
      return {
        ...a,
        row,
        kept,
        trainer: rotationSlots[a.slot],
        topic: topic ? topicLabel(topic, a.part, form.perSlot, form.numbered) : null
      };
    });
  });
  let changes = $derived(assignments.filter((a) => !a.kept));

  function slotLabel(slot: RotationSlot): string {
    if (slot.kind === 'trainer') return memberName.get(slot.memberId) ?? '';
    if (slot.kind === 'none') return $_('page.trainingPlan.rotation.none');
    return $_('page.trainingPlan.trainerOpen');
  }

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= slots.length) return;
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  async function apply() {
    if (changes.length === 0) return;
    saving = true;
    const upserts = changes.map(({ row, trainer, topic }) => ({
      training_id: row.training.id,
      date: row.date,
      notes: row.session?.notes ?? null,
      ...(mode === 'trainers'
        ? { topic: row.session?.topic ?? null, ...slotPatch(trainer) }
        : {
            topic,
            trainer_id: row.session?.trainer_id ?? null,
            cancelled: row.session?.cancelled ?? null
          })
    }));
    const { error } = await supabaseClient
      .from('training_plan_sessions')
      .upsert(upserts, { onConflict: 'training_id,date' });
    saving = false;
    if (error) {
      console.error('Error applying rotation:', error);
      toaster.error({ title: $_('page.trainingPlan.saveError') });
      return;
    }
    toaster.success({
      title: $_('page.trainingPlan.rotation.applied', { values: { count: upserts.length } })
    });
    onsaved();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  onclick={onclose}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="card modal-dialog modal-dialog-lg max-h-[90vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    <h3>{$_('page.trainingPlan.rotation.title')}</h3>
    <div class="flex rounded-lg overflow-hidden border border-surface-300-700 my-3">
      {#each ['trainers', 'topics'] as const as m (m)}
        <button
          type="button"
          class="btn btn-sm flex-1 rounded-none {mode === m
            ? 'preset-filled-primary-500'
            : 'preset-tonal-surface'}"
          onclick={() => (mode = m)}
        >
          {$_('page.trainingPlan.rotation.mode.' + m)}
        </button>
      {/each}
    </div>
    <p class="text-sm text-surface-600-400 mb-3">
      {mode === 'trainers'
        ? $_('page.trainingPlan.rotation.intro')
        : $_('page.trainingPlan.rotation.introTopics')}
    </p>

    <form
      class="space-y-3"
      onsubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label class="label">
        <span>{$_('page.trainingPlan.training')}</span>
        <select class="select" bind:value={form.trainingId}>
          {#each trainings as t (t.id)}
            <option value={t.id}>
              {$_('weekdayShort.' + t.weekday)}
              {t.dateFrom} · {t.title}
            </option>
          {/each}
        </select>
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class="label">
          <span>{$_('page.trainingPlan.from')}</span>
          <input class="input" type="date" bind:value={form.from} min={from} max={to} />
        </label>
        <label class="label">
          <span>{$_('page.trainingPlan.to')}</span>
          <input class="input" type="date" bind:value={form.to} min={from} max={to} />
        </label>
      </div>

      <div class="space-y-2">
        <span class="label-text">{$_('page.trainingPlan.rotation.slots')}</span>
        {#each slots as slot, i (i)}
          <div class="flex items-center gap-2">
            <span class="w-6 text-right text-sm text-surface-600-400">{i + 1}.</span>
            <div class="flex-1 min-w-0">
              {#if mode === 'trainers'}
                <TrainerSelect {members} bind:value={slot.value} allowNone />
              {:else}
                <input
                  class="input"
                  type="text"
                  list="rotation-topics"
                  placeholder={$_('page.trainingPlan.topicPlaceholder')}
                  bind:value={slot.topic}
                />
              {/if}
            </div>
            <button
              type="button"
              class="btn-icon btn-icon-sm preset-tonal-surface flex-none"
              onclick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={$_('page.trainingPlan.rotation.up')}
            >
              <Fa icon={faArrowUp} />
            </button>
            <button
              type="button"
              class="btn-icon btn-icon-sm preset-tonal-surface flex-none"
              onclick={() => move(i, 1)}
              disabled={i === slots.length - 1}
              aria-label={$_('page.trainingPlan.rotation.down')}
            >
              <Fa icon={faArrowDown} />
            </button>
            <button
              type="button"
              class="btn-icon btn-icon-sm preset-tonal-error flex-none"
              onclick={() => slots.splice(i, 1)}
              disabled={slots.length === 1}
              aria-label={$_('button.remove')}
            >
              <Fa icon={faTrash} />
            </button>
          </div>
        {/each}
        <button
          type="button"
          class="btn btn-sm preset-tonal-primary"
          onclick={() => slots.push({ value: null, topic: '' })}
        >
          <Fa icon={faPlus} />
          <span>{$_('page.trainingPlan.rotation.addSlot')}</span>
        </button>
        <datalist id="rotation-topics">
          {#each topics as t (t)}
            <option value={t}></option>
          {/each}
        </datalist>
      </div>

      <label class="label">
        <span>{$_('page.trainingPlan.rotation.perSlot')}</span>
        <input class="input w-24" type="number" min="1" max="12" bind:value={form.perSlot} />
      </label>

      {#if mode === 'topics' && form.perSlot > 1}
        <label class="flex items-start gap-2">
          <input class="checkbox mt-1" type="checkbox" bind:checked={form.numbered} />
          <span>{$_('page.trainingPlan.rotation.numbered')}</span>
        </label>
      {/if}

      <label class="flex items-start gap-2">
        <input class="checkbox mt-1" type="checkbox" bind:checked={form.skipCancelled} />
        <span>
          {$_('page.trainingPlan.rotation.skipCancelled')}
          <span class="block text-xs text-surface-600-400">
            {$_('page.trainingPlan.rotation.skipCancelledHint')}
          </span>
        </span>
      </label>
      <label class="flex items-start gap-2">
        <input class="checkbox mt-1" type="checkbox" bind:checked={form.overwrite} />
        <span>
          {$_('page.trainingPlan.rotation.overwrite')}
          <span class="block text-xs text-surface-600-400">
            {mode === 'trainers'
              ? $_('page.trainingPlan.rotation.overwriteHint')
              : $_('page.trainingPlan.rotation.overwriteHintTopics')}
          </span>
        </span>
      </label>

      <div>
        <span class="label-text">{$_('page.trainingPlan.rotation.preview')}</span>
        {#if assignments.length === 0}
          <p class="text-sm text-surface-600-400">{$_('page.trainingPlan.rotation.noDates')}</p>
        {:else}
          <ul
            class="text-sm max-h-48 overflow-y-auto rounded border border-surface-200-800 divide-y divide-surface-200-800"
          >
            {#each assignments as a (a.date)}
              <li class="flex justify-between gap-2 px-2 py-1 {a.kept ? 'opacity-50' : ''}">
                <span>{dayjs(a.date).format('DD.MM.YYYY')}</span>
                <span class="truncate">
                  {#if a.kept}
                    {$_('page.trainingPlan.rotation.kept')}
                  {:else if mode === 'trainers'}
                    {slotLabel(a.trainer)}
                  {:else}
                    {a.topic ?? '–'}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn preset-tonal-surface" onclick={onclose}>
          {$_('button.cancel')}
        </button>
        <button
          type="submit"
          class="btn preset-filled-primary-500"
          disabled={saving || changes.length === 0}
        >
          {saving
            ? $_('button.saving')
            : $_('page.trainingPlan.rotation.apply', { values: { count: changes.length } })}
        </button>
      </div>
    </form>
  </div>
</div>
