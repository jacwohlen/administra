<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faCheck,
    faCircleExclamation,
    faDoorClosed,
    faSpinner,
    faUmbrellaBeach
  } from '@fortawesome/free-solid-svg-icons';
  import { _, locale } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import type { PlanRow, PlanTraining } from '$lib/trainingPlanUtils';
  import TrainerSelect from './TrainerSelect.svelte';
  import type { PlanMember } from './members';

  let {
    training,
    rows,
    members,
    topics,
    canEdit,
    onchanged
  }: {
    training: PlanTraining;
    /** The dates of this training to show, oldest first */
    rows: PlanRow[];
    members: PlanMember[];
    /** Topics used so far, offered as suggestions */
    topics: string[];
    canEdit: boolean;
    /** Called once when leaving the table after something was saved */
    onchanged: () => void;
  } = $props();

  interface Draft {
    trainer: number | null | 'keep' | 'none';
    topic: string;
    notes: string;
    cancelled: boolean | null;
  }

  // Edited in place like a spreadsheet: every cell saves on its own, the
  // page reloads the plan only when leaving the table
  const drafts = $state<Record<string, Draft>>({});
  const status = $state<Record<string, 'saving' | 'saved' | 'error'>>({});
  let changed = false;

  $effect.pre(() => {
    for (const r of rows) {
      drafts[r.date] ??= {
        trainer: r.session?.trainer_id ?? null,
        topic: r.session?.topic ?? '',
        notes: r.session?.notes ?? '',
        cancelled: r.session?.cancelled ?? null
      };
    }
  });

  let mainTrainer = $derived(members.find((m) => m.id === training.mainTrainerId));
  let openLabel = $derived(
    mainTrainer
      ? `${mainTrainer.firstname} ${mainTrainer.lastname} (${$_('page.trainingPlan.mainTrainer')})`
      : $_('page.trainingPlan.trainerOpen')
  );

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const requests = new Map<string, number>();
  let counter = 0;

  /** Saves a row now, or after a pause in typing */
  function schedule(row: PlanRow, delay = 0) {
    clearTimeout(timers.get(row.date));
    if (delay === 0) {
      save(row);
    } else {
      timers.set(
        row.date,
        setTimeout(() => save(row), delay)
      );
    }
  }

  async function save(row: PlanRow) {
    timers.delete(row.date);
    const d = drafts[row.date];
    const request = ++counter;
    requests.set(row.date, request);
    status[row.date] = 'saving';
    const values = {
      trainer_id: typeof d.trainer === 'number' ? d.trainer : null,
      topic: d.topic.trim() || null,
      notes: d.notes.trim() || null,
      cancelled: d.cancelled
    };
    const empty =
      values.trainer_id == null && !values.topic && !values.notes && values.cancelled == null;
    const { error } = empty
      ? await supabaseClient
          .from('training_plan_sessions')
          .delete()
          .eq('training_id', training.id)
          .eq('date', row.date)
      : await supabaseClient
          .from('training_plan_sessions')
          .upsert(
            { training_id: training.id, date: row.date, ...values },
            { onConflict: 'training_id,date' }
          );
    if (requests.get(row.date) !== request) return;
    changed = true;
    if (error) {
      console.error('Error saving training plan:', error);
      status[row.date] = 'error';
      toaster.error({ title: $_('page.trainingPlan.saveError') });
      return;
    }
    status[row.date] = 'saved';
  }

  /** Cancelled as shown: the explicit choice, else the break */
  function isOff(row: PlanRow): boolean {
    return drafts[row.date]?.cancelled ?? row.break?.cancels_training ?? false;
  }

  function toggleOff(row: PlanRow) {
    const next = !isOff(row);
    // Back to null when it matches what the holidays say anyway
    drafts[row.date].cancelled = next === (row.break?.cancels_training ?? false) ? null : next;
    schedule(row);
  }

  let grid: HTMLDivElement | undefined = $state();

  function focusCell(index: number, col: string) {
    grid
      ?.querySelector<HTMLElement>(`[data-row="${index}"][data-col="${col}"]`)
      ?.focus({ preventScroll: false });
  }

  /** Enter and the arrow keys move up and down a column, as in a spreadsheet */
  function onKey(e: KeyboardEvent, index: number, col: string) {
    const select = (e.target as HTMLElement).tagName === 'SELECT';
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !select)) {
      e.preventDefault();
      focusCell(e.shiftKey ? index - 1 : index + 1, col);
    } else if (e.key === 'ArrowUp' && !select) {
      e.preventDefault();
      focusCell(index - 1, col);
    }
  }

  /** A column copied from a spreadsheet fills this row and the ones below */
  async function onPaste(e: ClipboardEvent, index: number, field: 'topic' | 'notes') {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!/\r?\n/.test(text.trim())) return;
    e.preventDefault();
    const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
    lines.forEach((line, j) => {
      const row = rows[index + j];
      if (!row) return;
      drafts[row.date][field] = line.split('\t')[0].trim();
      schedule(row);
    });
    await tick();
    focusCell(Math.min(index + lines.length, rows.length - 1), field);
    toaster.success({
      title: $_('page.trainingPlan.grid.pasted', {
        values: { count: Math.min(lines.length, rows.length - index) }
      })
    });
  }

  onDestroy(() => {
    for (const [date, timer] of timers) {
      clearTimeout(timer);
      const row = rows.find((r) => r.date === date);
      if (row) save(row);
    }
    if (changed || timers.size > 0) onchanged();
  });

  function monthLabel(date: string) {
    return new Date(date).toLocaleDateString($locale ?? 'de', { month: 'long', year: 'numeric' });
  }

  const today = dayjs().format('YYYY-MM-DD');
  const cols = 'sm:grid-cols-[4.5rem_13rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem_1rem]';
</script>

{#snippet saveState(date: string)}
  {#if status[date] === 'saving'}
    <Fa icon={faSpinner} spin size="xs" class="text-surface-500" />
  {:else if status[date] === 'saved'}
    <Fa icon={faCheck} size="xs" class="text-success-600-400" />
  {:else if status[date] === 'error'}
    <Fa icon={faCircleExclamation} size="xs" class="text-error-600-400" />
  {/if}
{/snippet}

{#if canEdit}
  <p class="text-xs text-surface-600-400 mb-3 print:hidden">{$_('page.trainingPlan.grid.hint')}</p>
{/if}

<datalist id="grid-topics">
  {#each topics as t (t)}
    <option value={t}></option>
  {/each}
</datalist>

<div bind:this={grid} class="text-sm">
  <div
    class="hidden sm:grid {cols} gap-x-2 px-1 pb-1 border-b border-surface-300-700 text-xs font-semibold text-surface-600-400"
  >
    <span>{$_('page.trainingPlan.grid.date')}</span>
    <span>{$_('page.trainingPlan.trainer')}</span>
    <span>{$_('page.trainingPlan.topic')}</span>
    <span>{$_('page.trainingPlan.notes')}</span>
    <span class="text-center">{$_('page.trainingPlan.cancelled')}</span>
    <span></span>
  </div>

  {#each rows as row, i (row.date)}
    {@const d = drafts[row.date]}
    {@const off = isOff(row)}
    {#if i === 0 || row.date.slice(0, 7) !== rows[i - 1].date.slice(0, 7)}
      <h3 class="mt-4 mb-1">{monthLabel(row.date)}</h3>
    {/if}
    {#if d}
      <div
        class="grid grid-cols-[3.5rem_minmax(0,1fr)] {cols} gap-x-2 gap-y-1 items-center px-1 py-1.5 border-b border-surface-200-800 {row.date ===
        today
          ? 'bg-primary-500/10'
          : ''}"
      >
        <div class="leading-tight self-start sm:self-center pt-1 sm:pt-0">
          <div class="text-xs text-surface-600-400">
            {$_('weekdayShort.' + training.weekday)}
          </div>
          <div class="font-bold tabular-nums {off ? 'line-through opacity-60' : ''}">
            {dayjs(row.date).format('DD.MM.')}
          </div>
          <!-- On phones the save state sits under the date -->
          <div class="sm:hidden h-4 mt-0.5">{@render saveState(row.date)}</div>
        </div>

        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-1 sm:contents">
          <TrainerSelect
            {members}
            bind:value={drafts[row.date].trainer}
            {openLabel}
            class="select h-10 sm:h-9 py-0 text-sm {off ? 'opacity-50' : ''}"
            data-row={i}
            data-col="trainer"
            disabled={!canEdit}
            onchange={() => schedule(row)}
            onkeydown={(e: KeyboardEvent) => onKey(e, i, 'trainer')}
          />
          <label
            class="flex items-center justify-center gap-1.5 min-h-10 px-1 sm:hidden text-xs cursor-pointer"
          >
            <input
              type="checkbox"
              class="checkbox"
              checked={off}
              disabled={!canEdit}
              onchange={() => toggleOff(row)}
            />
            <span>{$_('page.trainingPlan.cancelled')}</span>
          </label>
          <input
            class="input h-10 sm:h-9 py-0 text-sm col-span-2 sm:col-span-1 {off
              ? 'opacity-50'
              : ''}"
            type="text"
            list="grid-topics"
            placeholder={$_('page.trainingPlan.topic')}
            bind:value={drafts[row.date].topic}
            data-row={i}
            data-col="topic"
            disabled={!canEdit}
            oninput={() => schedule(row, 600)}
            onblur={() => timers.has(row.date) && schedule(row)}
            onkeydown={(e) => onKey(e, i, 'topic')}
            onpaste={(e) => onPaste(e, i, 'topic')}
          />
          <input
            class="input h-10 sm:h-9 py-0 text-sm col-span-2 sm:col-span-1"
            type="text"
            placeholder={$_('page.trainingPlan.notes')}
            bind:value={drafts[row.date].notes}
            data-row={i}
            data-col="notes"
            disabled={!canEdit}
            oninput={() => schedule(row, 600)}
            onblur={() => timers.has(row.date) && schedule(row)}
            onkeydown={(e) => onKey(e, i, 'notes')}
            onpaste={(e) => onPaste(e, i, 'notes')}
          />
          <label class="hidden sm:flex justify-center items-center h-9 cursor-pointer">
            <input
              type="checkbox"
              class="checkbox"
              checked={off}
              disabled={!canEdit}
              aria-label={$_('page.trainingPlan.cancelled')}
              data-row={i}
              data-col="off"
              onchange={() => toggleOff(row)}
              onkeydown={(e) => onKey(e, i, 'off')}
            />
          </label>
        </div>

        <span class="hidden sm:inline-flex justify-center" aria-live="polite">
          {@render saveState(row.date)}
        </span>

        {#if row.break || row.events.length > 0}
          <div
            class="col-start-2 sm:col-start-2 sm:col-span-4 flex flex-wrap gap-1 text-xs text-surface-600-400"
          >
            {#if row.break}
              <span
                class="badge text-xs {row.break.cancels_training
                  ? 'preset-tonal-warning'
                  : 'preset-tonal-surface'}"
              >
                <Fa icon={row.break.cancels_training ? faDoorClosed : faUmbrellaBeach} size="xs" />
                {row.break.title}
              </span>
            {/if}
            {#each row.events as e (e.id)}
              <span class="badge preset-tonal-secondary text-xs">
                <Fa icon={faCalendarDays} size="xs" />
                {e.title}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/each}
</div>
