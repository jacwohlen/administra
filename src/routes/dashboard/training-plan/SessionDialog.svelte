<script lang="ts">
  import { modalDialog } from '$lib/modalDialog';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faCalendarDays, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import type { PlanRow } from '$lib/trainingPlanUtils';
  import TrainerSelect from './TrainerSelect.svelte';
  import type { PlanMember } from './members';

  let {
    rows,
    members,
    topics,
    onclose,
    onsaved
  }: {
    /** One row edits that session; several set the chosen fields on all of them */
    rows: PlanRow[];
    members: PlanMember[];
    /** Topics used so far, offered as suggestions */
    topics: string[];
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  type Status = 'keep' | 'auto' | 'held' | 'cancelled';

  // svelte-ignore state_referenced_locally
  const single = rows.length === 1 ? rows[0] : null;
  let form = $state({
    trainer: single
      ? (single.session?.trainer_id ?? null)
      : ('keep' as number | null | 'keep' | 'none'),
    topic: single?.session?.topic ?? '',
    notes: single?.session?.notes ?? '',
    status: (single
      ? single.session?.cancelled == null
        ? 'auto'
        : single.session.cancelled
          ? 'cancelled'
          : 'held'
      : 'keep') as Status
  });
  let saving = $state(false);

  function cancelledValue(status: Status, current: boolean | null): boolean | null {
    if (status === 'keep') return current;
    if (status === 'auto') return null;
    return status === 'cancelled';
  }

  async function save() {
    saving = true;
    const upserts = [];
    const deletes: number[] = [];
    for (const row of rows) {
      const s = row.session;
      const next = {
        training_id: row.training.id,
        date: row.date,
        trainer_id:
          form.trainer === 'keep'
            ? (s?.trainer_id ?? null)
            : typeof form.trainer === 'number'
              ? form.trainer
              : null,
        // With several rows an empty topic leaves the topics as they are
        topic: single ? form.topic.trim() || null : form.topic.trim() || s?.topic || null,
        notes: single ? form.notes.trim() || null : (s?.notes ?? null),
        cancelled: cancelledValue(form.status, s?.cancelled ?? null)
      };
      const empty = next.trainer_id == null && !next.topic && !next.notes && next.cancelled == null;
      if (empty) {
        if (s) deletes.push(s.id);
      } else {
        upserts.push(next);
      }
    }

    const results = await Promise.all([
      upserts.length > 0
        ? supabaseClient
            .from('training_plan_sessions')
            .upsert(upserts, { onConflict: 'training_id,date' })
        : Promise.resolve({ error: null }),
      deletes.length > 0
        ? supabaseClient.from('training_plan_sessions').delete().in('id', deletes)
        : Promise.resolve({ error: null })
    ]);
    saving = false;
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      console.error('Error saving training plan:', failed.error);
      toaster.error({ title: $_('page.trainingPlan.saveError') });
      return;
    }
    toaster.success({ title: $_('page.trainingPlan.saved') });
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
    use:modalDialog
    class="card modal-dialog modal-dialog-lg max-h-[90vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    {#if single}
      <h3>{single.training.title}</h3>
      <p class="text-sm text-surface-600-400 mb-3">
        {$_('weekday.' + single.training.weekday)}, {dayjs(single.date).format('DD.MM.YYYY')} · {single
          .training.dateFrom}
      </p>
    {:else}
      <h3>{$_('page.trainingPlan.editSelected', { values: { count: rows.length } })}</h3>
      <p class="text-sm text-surface-600-400 mb-3">{$_('page.trainingPlan.editSelectedHint')}</p>
    {/if}

    <form
      class="space-y-3"
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label class="label">
        <span>{$_('page.trainingPlan.trainer')}</span>
        <TrainerSelect {members} bind:value={form.trainer} allowKeep={!single} />
      </label>

      <label class="label">
        <span>{$_('page.trainingPlan.topic')}</span>
        <input
          class="input"
          type="text"
          list="training-plan-topics"
          placeholder={single
            ? $_('page.trainingPlan.topicPlaceholder')
            : $_('page.trainingPlan.keep')}
          bind:value={form.topic}
        />
        <datalist id="training-plan-topics">
          {#each topics as t (t)}
            <option value={t}></option>
          {/each}
        </datalist>
      </label>

      {#if single}
        <label class="label">
          <span>{$_('page.trainingPlan.notes')}</span>
          <textarea class="textarea" rows="2" bind:value={form.notes}></textarea>
        </label>
      {/if}

      <label class="label">
        <span>{$_('page.trainingPlan.status.label')}</span>
        <select class="select" bind:value={form.status}>
          {#if !single}
            <option value="keep">{$_('page.trainingPlan.keep')}</option>
          {/if}
          <option value="auto">
            {single?.break?.cancels_training
              ? $_('page.trainingPlan.status.autoBreak', { values: { title: single.break.title } })
              : $_('page.trainingPlan.status.auto')}
          </option>
          <option value="held">{$_('page.trainingPlan.status.held')}</option>
          <option value="cancelled">{$_('page.trainingPlan.status.cancelled')}</option>
        </select>
        <span class="block text-xs text-surface-600-400">
          {$_('page.trainingPlan.status.hint')}
        </span>
      </label>

      {#if single && single.events.length > 0}
        <div class="flex items-start gap-2 p-3 rounded-lg preset-tonal-secondary text-sm">
          <Fa icon={faCalendarDays} class="mt-0.5 flex-none" />
          <span>
            <span class="font-semibold">{$_('page.trainingPlan.eventsThatDay')}:</span>
            {single.events.map((e) => e.title).join(', ')}
          </span>
        </div>
      {/if}

      <footer class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn preset-tonal-surface" onclick={onclose}>
          {$_('button.cancel')}
        </button>
        <button type="submit" class="btn preset-filled-primary-500" disabled={saving}>
          {#if saving}<Fa icon={faSpinner} spin />{/if}
          <span>{$_('button.save')}</span>
        </button>
      </footer>
    </form>
  </div>
</div>
