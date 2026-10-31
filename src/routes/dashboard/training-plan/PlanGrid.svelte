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
  import { planKey, type PlanRow } from '$lib/trainingPlanUtils';
  import TrainerSelect from './TrainerSelect.svelte';
  import type { PlanMember } from './members';

  let {
    rows,
    members,
    topics,
    canEdit,
    waiting = false,
    onchanged
  }: {
    /**
     * The dates of the picked trainings to show, as buildPlan() sorts them
     * (date, start time): two trainings can share a date, so everything here
     * goes by training and date (planKey)
     */
    rows: PlanRow[];
    members: PlanMember[];
    /** Topics used so far, offered as suggestions */
    topics: string[];
    canEdit: boolean;
    /**
     * The plan is being reloaded with what was saved: the rows are from
     * before, so the cells wait for it
     */
    waiting?: boolean;
    /**
     * Called once when leaving the table after something was edited, with
     * the saves still landing: the page reloads the plan once they have
     */
    onchanged: (saves: Promise<unknown>) => void;
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

  // The session each draft was taken from, and the rows edited here
  const loaded = new Map<string, PlanRow['session']>();
  const edited = new Set<string>();

  $effect.pre(() => {
    for (const r of rows) {
      const k = planKey(r);
      // A row not edited here follows the plan as loaded: the table can
      // open before the plan is reloaded with what the previous one saved
      if (edited.has(k) || (loaded.has(k) && loaded.get(k) === r.session)) continue;
      loaded.set(k, r.session);
      drafts[k] = {
        trainer: r.session?.trainer_id ?? null,
        topic: r.session?.topic ?? '',
        notes: r.session?.notes ?? '',
        cancelled: r.session?.cancelled ?? null
      };
    }
  });

  // Read-only for viewers, and until the plan is reloaded
  let editable = $derived(canEdit && !waiting);

  // Several trainings: each row says which one it is
  let several = $derived(new Set(rows.map((r) => r.training.id)).size > 1);

  /** Per training: without a trainer planned, its main trainer leads */
  let openLabels = $derived.by(() => {
    const labels = new Map<number, string>();
    for (const { training } of rows) {
      if (labels.has(training.id)) continue;
      const main = members.find((m) => m.id === training.mainTrainerId);
      labels.set(
        training.id,
        main
          ? `${main.firstname} ${main.lastname} (${$_('page.trainingPlan.mainTrainer')})`
          : $_('page.trainingPlan.trainerOpen')
      );
    }
    return labels;
  });

  /** Rows waiting for a pause in typing, and the saves under way */
  const timers = new Map<string, { row: PlanRow; timer: ReturnType<typeof setTimeout> }>();
  const saving = new Set<Promise<void>>();
  const requests = new Map<string, number>();
  let counter = 0;

  /** Saves a row now, or after a pause in typing */
  function schedule(row: PlanRow, delay = 0) {
    const k = planKey(row);
    edited.add(k);
    clearTimeout(timers.get(k)?.timer);
    timers.delete(k);
    if (delay === 0) {
      save(row);
    } else {
      timers.set(k, { row, timer: setTimeout(() => save(row), delay) });
    }
  }

  /** Starts saving a row; the reload after leaving the table waits for it */
  function save(row: PlanRow) {
    const pending = write(row).finally(() => saving.delete(pending));
    saving.add(pending);
  }

  async function write(row: PlanRow) {
    const k = planKey(row);
    timers.delete(k);
    const d = drafts[k];
    const request = ++counter;
    requests.set(k, request);
    status[k] = 'saving';
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
          .eq('training_id', row.training.id)
          .eq('date', row.date)
      : await supabaseClient
          .from('training_plan_sessions')
          .upsert(
            { training_id: row.training.id, date: row.date, ...values },
            { onConflict: 'training_id,date' }
          );
    if (requests.get(k) !== request) return;
    changed = true;
    if (error) {
      console.error('Error saving training plan:', error);
      status[k] = 'error';
      toaster.error({ title: $_('page.trainingPlan.saveError') });
      return;
    }
    status[k] = 'saved';
  }

  /** Cancelled as shown: the explicit choice, else the break */
  function isOff(row: PlanRow): boolean {
    return drafts[planKey(row)]?.cancelled ?? row.break?.cancels_training ?? false;
  }

  function toggleOff(row: PlanRow) {
    const next = !isOff(row);
    // Back to null when it matches what the holidays say anyway
    drafts[planKey(row)].cancelled = next === (row.break?.cancels_training ?? false) ? null : next;
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
      drafts[planKey(row)][field] = line.split('\t')[0].trim();
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

  // Leaving the table: typing still waiting is saved now, and the page
  // reloads the plan once all saves have landed, so that it shows them
  onDestroy(() => {
    const typing = [...timers.values()];
    timers.clear();
    for (const { row, timer } of typing) {
      clearTimeout(timer);
      save(row);
    }
    if (changed || saving.size > 0) onchanged(Promise.allSettled([...saving]));
  });

  function monthLabel(date: string) {
    return new Date(date).toLocaleDateString($locale ?? 'de', { month: 'long', year: 'numeric' });
  }

  /** Names the row's controls for screen readers: "Fr 06.11.2026 · Randori" */
  function rowLabel(row: PlanRow) {
    const day = $_('weekdayShort.' + row.training.weekday);
    return `${day} ${dayjs(row.date).format('DD.MM.YYYY')} · ${row.training.title}`;
  }

  const today = dayjs().format('YYYY-MM-DD');
  // With several trainings the first column also names the training
  let cols = $derived(
    several
      ? 'sm:grid-cols-[8rem_13rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem_1rem]'
      : 'sm:grid-cols-[4.5rem_13rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem_1rem]'
  );
</script>

{#snippet saveState(key: string)}
  {#if status[key] === 'saving'}
    <Fa icon={faSpinner} spin size="xs" class="text-surface-500" />
  {:else if status[key] === 'saved'}
    <Fa icon={faCheck} size="xs" class="text-success-600-400" />
  {:else if status[key] === 'error'}
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

  {#each rows as row, i (planKey(row))}
    {@const k = planKey(row)}
    {@const d = drafts[k]}
    {@const off = isOff(row)}
    {#if i === 0 || row.date.slice(0, 7) !== rows[i - 1].date.slice(0, 7)}
      <h3 class="mt-4 mb-1">{monthLabel(row.date)}</h3>
    {/if}
    {#if d}
      <div
        role="group"
        aria-label={rowLabel(row)}
        class="grid grid-cols-[3.5rem_minmax(0,1fr)] {cols} gap-x-2 gap-y-1 items-center px-1 py-1.5 border-b border-surface-200-800 {row.date ===
        today
          ? 'bg-primary-500/10'
          : ''}"
      >
        <div class="leading-tight self-start sm:self-center pt-1 sm:pt-0 min-w-0">
          {#if several}
            <!-- The training next to the weekday, as on its chip; on phones above the fields -->
            <div class="text-xs text-surface-600-400 truncate" title={row.training.title}>
              {$_('weekdayShort.' + row.training.weekday)}<span class="hidden sm:inline"
                >{' · ' + row.training.title}</span
              >
            </div>
          {:else}
            <div class="text-xs text-surface-600-400">
              {$_('weekdayShort.' + row.training.weekday)}
            </div>
          {/if}
          <div class="font-bold tabular-nums {off ? 'line-through opacity-60' : ''}">
            {dayjs(row.date).format('DD.MM.')}
          </div>
          <!-- On phones the save state sits under the date -->
          <div class="sm:hidden h-4 mt-0.5">{@render saveState(k)}</div>
        </div>

        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-1 sm:contents">
          {#if several}
            <div
              class="col-span-2 sm:hidden text-xs font-semibold truncate"
              title={row.training.title}
            >
              {row.training.title}
            </div>
          {/if}
          <TrainerSelect
            {members}
            bind:value={drafts[k].trainer}
            openLabel={openLabels.get(row.training.id)}
            class="select h-10 sm:h-9 py-0 text-sm {off ? 'opacity-50' : ''}"
            aria-label={$_('page.trainingPlan.trainer')}
            data-row={i}
            data-col="trainer"
            disabled={!editable}
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
              disabled={!editable}
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
            bind:value={drafts[k].topic}
            data-row={i}
            data-col="topic"
            disabled={!editable}
            oninput={() => schedule(row, 600)}
            onblur={() => timers.has(k) && schedule(row)}
            onkeydown={(e) => onKey(e, i, 'topic')}
            onpaste={(e) => onPaste(e, i, 'topic')}
          />
          <input
            class="input h-10 sm:h-9 py-0 text-sm col-span-2 sm:col-span-1"
            type="text"
            placeholder={$_('page.trainingPlan.notes')}
            bind:value={drafts[k].notes}
            data-row={i}
            data-col="notes"
            disabled={!editable}
            oninput={() => schedule(row, 600)}
            onblur={() => timers.has(k) && schedule(row)}
            onkeydown={(e) => onKey(e, i, 'notes')}
            onpaste={(e) => onPaste(e, i, 'notes')}
          />
          <label class="hidden sm:flex justify-center items-center h-9 cursor-pointer">
            <input
              type="checkbox"
              class="checkbox"
              checked={off}
              disabled={!editable}
              aria-label={$_('page.trainingPlan.cancelled')}
              data-row={i}
              data-col="off"
              onchange={() => toggleOff(row)}
              onkeydown={(e) => onKey(e, i, 'off')}
            />
          </label>
        </div>

        <span class="hidden sm:inline-flex justify-center" aria-live="polite">
          {@render saveState(k)}
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
