<script lang="ts">
  import { untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faChevronUp,
    faCircleExclamation,
    faPen,
    faRotateRight,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import type { TrainingPlanBreak } from '$lib/models';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { providerName } from '$lib/memberStatus';
  import type { PlanTraining } from '$lib/trainingPlanUtils';
  import { MAX_LENGTH, clubToday, isIsoDate } from '$lib/assistant/proposals';
  import {
    PORTION,
    applyLeaderChoice,
    buildBreakWrites,
    buildPlanWrites,
    confirmTraining,
    dateSpan,
    holidayRowsOf,
    initialHolidayInputs,
    initialPlanInputs,
    insertBreaks,
    leaderKey,
    markSaved,
    matchLeaders,
    reviewHolidays,
    reviewPlan,
    rowValues,
    sessionRowsOf,
    setRowTrainer,
    setRowTraining,
    skipIncomplete,
    skipIncompleteHolidays,
    summarizePlan,
    trainingGuessGroup,
    weekdayOf,
    writeInPortions,
    type HolidayInput,
    type HolidayIssue,
    type HolidayStatus,
    type PlanChange,
    type PlanIssue,
    type PlanReviewContext,
    type PlanReviewInput,
    type PlanReviewMember,
    type PlanRowStatus,
    type PlannedBreak,
    type PlannedSession
  } from '$lib/assistant/trainingPlan';
  import type { PlanSessionEntry, TrainingPlanProposal } from '$lib/assistant/types';
  // The plan's own trainer picker (trainers first, then the other members)
  import TrainerSelect from '../TrainerSelect.svelte';

  /**
   * Review step of the Daten-Assistent for a training plan: every session
   * the model read, mapped to a planned training and a member and compared
   * with what the TK planned already, plus the holidays. New sessions and
   * ones that only fill empty fields are saved right away; sessions that
   * contradict the plan only when the user ticks it.
   *
   * When some writes fail, the review stays open: saved rows are marked and
   * left out, failed ones say so, and the plan and the holidays are read
   * again so that a write that went through despite an error shows as
   * recorded and is not written twice.
   */
  let {
    proposal,
    trainings,
    members,
    breaks,
    onback,
    oncancel,
    onapplied,
    onpartial
  }: {
    proposal: TrainingPlanProposal;
    /** The planned trainings */
    trainings: PlanTraining[];
    members: PlanReviewMember[];
    /** Holidays recorded already */
    breaks: TrainingPlanBreak[];
    onback: () => void;
    oncancel: () => void;
    /** Everything was saved: close the dialog and reload the page */
    onapplied: () => void;
    /**
     * Not everything was saved, the review stays open. `breaks` are the
     * holidays recorded now; the page has to reload when the dialog closes.
     */
    onpartial: (breaks: TrainingPlanBreak[]) => void;
  } = $props();

  /** PostgREST returns at most 1000 rows per request */
  const PAGE = 1000;
  const uid = $props.id();
  const today = clubToday();

  const leaders = untrack(() => matchLeaders(proposal.sessions, members));
  const leaderList = [...leaders.values()].sort((a, b) => a.name.localeCompare(b.name));
  let leaderChoice = $state<Record<string, number | null>>(
    Object.fromEntries(leaderList.map((l) => [l.key, l.memberId]))
  );
  let confirmedNames = $state<Record<string, boolean>>({});
  let confirmed = $derived(new Set(Object.keys(confirmedNames).filter((k) => confirmedNames[k])));

  let inputs = $state<PlanReviewInput[]>(
    untrack(() => initialPlanInputs(proposal.sessions, trainings, leaders))
  );
  let holidayInputs = $state<HolidayInput[]>(
    untrack(() => initialHolidayInputs(proposal.holidays, breaks))
  );
  let planned = $state.raw<PlanReviewContext['planned']>(null);
  let loadFailed = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);
  let busy = $derived(progress !== null);

  /** The holidays as read again after a partial save */
  let reloadedBreaks = $state.raw<TrainingPlanBreak[] | null>(null);
  let recorded = $derived(reloadedBreaks ?? breaks);
  /** Rows whose write failed in the last apply */
  let failedSessions = $state<Record<number, boolean>>({});
  let failedHolidays = $state<Record<number, boolean>>({});
  /** An apply did not save everything (a failed write may have gone through): leaving closes */
  let attempted = $state(false);

  let holidayRows = $derived(reviewHolidays(proposal.holidays, holidayInputs, recorded));
  /** Recorded holidays plus the ones about to be added (or just added), for the "dojo closed" check */
  let planBreaks = $derived<PlannedBreak[]>([
    ...recorded,
    ...holidayRows.flatMap((h): PlannedBreak[] =>
      h.write
        ? [h.write]
        : h.input.saved && h.status === 'new'
          ? [
              {
                title: h.input.title,
                date_from: h.input.dateFrom,
                date_to: h.input.dateTo || h.input.dateFrom,
                cancels_training: h.input.closed
              }
            ]
          : []
    )
  ]);
  let rows = $derived(
    reviewPlan(proposal.sessions, inputs, {
      trainings,
      members,
      planned,
      breaks: planBreaks,
      leaders,
      confirmed,
      today
    })
  );
  let summary = $derived(summarizePlan(rows, holidayRows));
  let count = $derived(summary.sessions + summary.breaks);
  let span = $derived(dateSpan(inputs.map((i) => i.date)));
  let canApply = $derived(
    !busy && !loadFailed && count > 0 && summary.blocking === 0 && summary.waiting === 0
  );
  /** A failed write the reload shows as recorded did go through after all */
  let sessionFailed = $derived(
    rows.map((r, i) => !!failedSessions[i] && !r.input.saved && r.status !== 'exists')
  );
  let holidayFailed = $derived(
    holidayRows.map((h, i) => !!failedHolidays[i] && !h.input.saved && h.status !== 'exists')
  );
  let failedCount = $derived(
    sessionFailed.filter(Boolean).length + holidayFailed.filter(Boolean).length
  );
  let anySaved = $derived(
    inputs.some((input) => input.saved) || holidayInputs.some((input) => input.saved)
  );

  // Rows that need a fix start open
  let editing = $state<Record<number, boolean>>(
    untrack(() =>
      Object.fromEntries(
        rows.flatMap((r, i) => (r.errors.length > 0 && !r.input.skip ? [[i, true]] : []))
      )
    )
  );

  const STATUS_CLASS: Record<PlanRowStatus | HolidayStatus, string> = {
    new: 'preset-tonal-success',
    exists: 'preset-tonal-surface',
    fill: 'preset-tonal-primary',
    changed: 'preset-tonal-warning',
    duplicate: 'preset-tonal-surface',
    invalid: 'preset-tonal-error',
    provider: 'preset-tonal-surface'
  };

  let memberById = $derived(new Map(members.map((m) => [m.id, m])));

  // What is planned already for the dates of the review: loaded again when
  // a date is moved outside the loaded period
  let request = 0;
  async function loadPlanned(from: string, to: string) {
    const id = ++request;
    try {
      const sessions: PlannedSession[] = [];
      for (let offset = 0; trainings.length > 0; offset += PAGE) {
        const { data, error } = await supabaseClient
          .from('training_plan_sessions')
          .select('id, training_id, date, trainer_id, topic, notes, cancelled')
          .in(
            'training_id',
            trainings.map((t) => t.id)
          )
          .gte('date', from)
          .lte('date', to)
          .order('id')
          .range(offset, offset + PAGE - 1)
          .returns<PlannedSession[]>();
        if (error) throw error;
        sessions.push(...(data ?? []));
        if ((data?.length ?? 0) < PAGE) break;
      }
      if (id === request) planned = { from, to, sessions };
    } catch (err) {
      console.error('Error loading the training plan for the assistant:', err);
      if (id === request) loadFailed = true;
    }
  }

  $effect(() => {
    const need = span;
    const have = planned;
    if (!need || loadFailed) return;
    if (have && have.from <= need.from && need.to <= have.to) return;
    untrack(() => loadPlanned(need.from, need.to));
  });

  type TrainerValue = number | null | 'keep' | 'none';

  /** The user picked a training: their choice, no guess to confirm */
  function setTraining(i: number, trainingId: number | null) {
    inputs[i] = setRowTraining(inputs[i], trainingId);
  }

  /** The weekday's training is right (for all rows of the same written training) */
  function confirmGuess(i: number) {
    inputs = confirmTraining(rows, inputs, i);
  }

  function setTrainer(i: number, value: TrainerValue) {
    const next = typeof value === 'number' ? value : null;
    inputs[i] = setRowTrainer(proposal.sessions[i], inputs[i], next);
  }

  /** A name's member was changed: the rows with that name follow */
  function setLeader(key: string, value: TrainerValue) {
    const next = typeof value === 'number' ? value : null;
    const previous = leaderChoice[key] ?? null;
    confirmedNames[key] = true;
    if (next === previous) return;
    leaderChoice[key] = next;
    inputs = applyLeaderChoice(proposal.sessions, inputs, key, previous, next);
  }

  function memberName(id: number | null): string {
    if (id === null) return $_('page.trainingPlan.trainerOpen');
    const m = memberById.get(id);
    return m ? `${m.firstname} ${m.lastname}` : $_('assistant.trainingPlan.otherMember');
  }

  function trainingLabel(t: PlanTraining): string {
    return `${$_('weekdayShort.' + t.weekday)} ${t.dateFrom} ${t.title}`;
  }

  function dateLabel(date: string): string {
    if (!isIsoDate(date)) return date || '–';
    return `${$_('weekdayShort.' + weekdayOf(date))} ${dayjs(date).format('DD.MM.YYYY')}`;
  }

  function period(from: string, to: string): string {
    const end = dayjs(to).format('DD.MM.YYYY');
    return from === to ? end : `${dayjs(from).format('DD.MM.')} – ${end}`;
  }

  function statusText(status: PlanRowStatus | HolidayStatus): string {
    return status === 'fill' || status === 'provider'
      ? $_(`assistant.trainingPlan.status.${status}`)
      : $_(`assistant.review.status.${status}`);
  }

  /** What the model read, as plain text */
  function written(entry: PlanSessionEntry): string {
    return [
      isIsoDate(entry.date) ? dayjs(entry.date).format('DD.MM.YYYY') : entry.date,
      entry.trainingAsWritten,
      entry.trainer,
      entry.topic,
      entry.notes,
      entry.cancelled ? $_('page.trainingPlan.cancelled') : ''
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function fieldLabel(field: PlanChange['field']): string {
    return field === 'cancelled'
      ? $_('page.trainingPlan.status.label')
      : $_(`page.trainingPlan.${field}`);
  }

  function changeValue(change: PlanChange, side: 'from' | 'to'): string {
    if (change.field === 'trainer') return memberName(change[side]);
    if (change.field === 'cancelled') {
      const value = change[side];
      return $_(
        `page.trainingPlan.status.${value === true ? 'cancelled' : value === false ? 'held' : 'auto'}`
      );
    }
    return change[side]?.trim() || '–';
  }

  function issueText(issue: PlanIssue): string {
    switch (issue.code) {
      case 'weekday':
        return $_('assistant.trainingPlan.issues.weekday', {
          values: {
            training: $_('weekday.' + issue.trainingWeekday),
            date: $_('weekday.' + issue.dateWeekday)
          }
        });
      case 'trainerUnconfirmed':
        return $_('assistant.trainingPlan.issues.trainerUnconfirmed', {
          values: { name: issue.name, member: memberName(issue.memberId) }
        });
      case 'trainerUnmatched':
      case 'closedBreak':
        return $_(`assistant.trainingPlan.issues.${issue.code}`, { values: { ...issue } });
      default:
        return $_(`assistant.trainingPlan.issues.${issue.code}`);
    }
  }

  function holidayIssueText(issue: HolidayIssue): string {
    return $_(`assistant.trainingPlan.holidayIssues.${issue.code}`);
  }

  /** Leaves out every row that still needs a fix, so the rest can be saved */
  function skipAllIncomplete() {
    inputs = skipIncomplete(rows, inputs);
    holidayInputs = skipIncompleteHolidays(holidayRows, holidayInputs);
  }

  /** All recorded holidays, as the page lists them */
  async function reloadBreaks() {
    try {
      const { data, error } = await supabaseClient
        .from('training_plan_breaks')
        .select('id, title, date_from, date_to, cancels_training, connection')
        .order('date_from', { ascending: false })
        .returns<TrainingPlanBreak[]>();
      if (error) throw error;
      reloadedBreaks = data ?? [];
    } catch (err) {
      console.error('Error reloading holidays after saving from the assistant:', err);
    }
  }

  /** The holidays recorded in a period, null when they cannot be read */
  async function breaksBetween(span: { from: string; to: string }) {
    try {
      const { data, error } = await supabaseClient
        .from('training_plan_breaks')
        .select('title, date_from, date_to, cancels_training, connection')
        .lte('date_from', span.to)
        .gte('date_to', span.from)
        .returns<PlannedBreak[]>();
      if (error) throw error;
      return data ?? [];
    } catch (err) {
      console.error('Error checking holidays from the assistant:', err);
      return null;
    }
  }

  async function apply() {
    if (!canApply) return;
    const sessionRows = rows;
    const breakRows = holidayRows;
    const sessions = buildPlanWrites(sessionRows, { trainings, members });
    const holidays = buildBreakWrites(breakRows);
    const total = sessions.length + holidays.length;
    if (total === 0) return;
    progress = { done: 0, total };
    failedSessions = {};
    failedHolidays = {};

    // Sessions in portions of PORTION rows; a failed portion is
    // retried row by row so the failures are known per session (an upsert
    // on training and date: writing one twice changes nothing)
    const savedSessions = await writeInPortions(
      sessions,
      PORTION,
      async (portion) => {
        try {
          const { error } = await supabaseClient
            .from('training_plan_sessions')
            .upsert(portion, { onConflict: 'training_id,date' });
          if (error) throw error;
          return true;
        } catch (err) {
          console.error('Error saving the training plan from the assistant:', err);
          return false;
        }
      },
      (done) => {
        if (progress) progress.done = done;
      }
    );
    // Holidays have no unique key: never inserted twice, see insertBreaks.
    // The recorded ones are always read first: the list the review compares
    // with may be older than the table (a reading after a partial save
    // whose reload failed, another tab)
    const savedBreaks = await insertBreaks(
      holidays,
      async (portion) => {
        try {
          const { error } = await supabaseClient.from('training_plan_breaks').insert(portion);
          if (error) throw error;
          return true;
        } catch (err) {
          console.error('Error saving holidays from the assistant:', err);
          return false;
        }
      },
      breaksBetween,
      {
        checkFirst: true,
        onProgress: (done) => {
          if (progress) progress.done = sessions.length + done;
        }
      }
    );

    const saved = savedSessions.saved.length + savedBreaks.saved.length;
    const failed = savedSessions.failed.length + savedBreaks.failed.length;
    if (failed === 0) {
      toaster.success({ title: $_('assistant.review.done', { values: { count: saved } }) });
      onapplied();
      return;
    }
    // Not everything went through: the review stays open to retry or close.
    // Saved rows are never written again, failed ones say so, and the plan
    // and the holidays are read again (a write can commit and still fail).
    inputs = markSaved(inputs, sessionRowsOf(sessionRows, savedSessions.saved));
    holidayInputs = markSaved(holidayInputs, holidayRowsOf(breakRows, savedBreaks.saved));
    failedSessions = Object.fromEntries(
      sessionRowsOf(sessionRows, savedSessions.failed).map((i) => [i, true])
    );
    failedHolidays = Object.fromEntries(
      holidayRowsOf(breakRows, savedBreaks.failed).map((i) => [i, true])
    );
    attempted = true;
    // Loaded again by the effect; apply waits for it
    planned = null;
    await reloadBreaks();
    progress = null;
    onpartial(recorded);
    if (saved > 0) {
      toaster.warning({ title: $_('assistant.review.partial', { values: { saved, failed } }) });
    } else {
      toaster.error({ title: $_('assistant.review.error') });
    }
  }
</script>

<div class="space-y-4">
  {#if rows.length === 0 && holidayRows.length === 0}
    <p class="text-sm text-surface-600-400">{$_('assistant.trainingPlan.empty')}</p>
  {/if}

  {#if rows.length > 0}
    <div class="space-y-2">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {#if span}
          <p class="text-sm">
            {$_('assistant.trainingPlan.summary', {
              values: {
                count: rows.length,
                from: dayjs(span.from).format('DD.MM.YYYY'),
                to: dayjs(span.to).format('DD.MM.YYYY')
              }
            })}
          </p>
        {/if}
        <div class="flex flex-wrap gap-1.5 text-xs">
          {#each Object.entries(summary.byStatus) as [status, n] (status)}
            {#if n > 0}
              <span class="badge {STATUS_CLASS[status as PlanRowStatus]}">
                {n} × {statusText(status as PlanRowStatus)}
              </span>
            {/if}
          {/each}
        </div>
      </div>
      <p class="text-xs text-surface-600-400">{$_('assistant.trainingPlan.keepHint')}</p>
    </div>

    {#if loadFailed}
      <div
        class="flex flex-wrap items-center gap-2 p-3 rounded-lg preset-tonal-error text-sm"
        role="alert"
      >
        <Fa icon={faTriangleExclamation} class="flex-none" />
        <span class="flex-1 min-w-0">{$_('assistant.trainingPlan.loadError')}</span>
        <button
          type="button"
          class="btn btn-sm preset-tonal-surface"
          onclick={() => (loadFailed = false)}
        >
          <Fa icon={faRotateRight} />
          <span>{$_('assistant.trainingPlan.retry')}</span>
        </button>
      </div>
    {/if}
  {/if}

  {#if leaderList.length > 0}
    <div>
      <p class="font-semibold text-sm">{$_('assistant.trainingPlan.leaders')}</p>
      <p class="text-xs text-surface-600-400 mb-2">{$_('assistant.trainingPlan.leadersHint')}</p>
      <ul class="space-y-2">
        {#each leaderList as leader, l (leader.key)}
          {@const suggested =
            leader.kind === 'suggested' && leaderChoice[leader.key] === leader.memberId}
          <li
            class="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] items-center"
          >
            <span class="text-sm min-w-0 break-words">
              <span id="{uid}-leader-{l}">{leader.name}</span>
              <span class="text-xs text-surface-600-400">
                ({$_('assistant.trainingPlan.leaderCount', { values: { count: leader.count } })})
              </span>
            </span>
            <div class="flex flex-wrap items-center gap-2 min-w-0">
              <TrainerSelect
                {members}
                class="select text-sm flex-1 min-w-0"
                aria-labelledby="{uid}-leader-{l}"
                disabled={busy}
                bind:value={() => leaderChoice[leader.key] ?? null, (v) => setLeader(leader.key, v)}
              />
              {#if suggested && !confirmedNames[leader.key]}
                <span class="badge text-xs preset-tonal-warning">
                  {$_('assistant.trainingPlan.leaderSuggested')}
                </span>
              {:else if leader.kind === 'none' && leaderChoice[leader.key] === null}
                <span class="badge text-xs preset-tonal-surface">
                  {$_('assistant.review.noMatch')}
                </span>
              {/if}
              {#if suggested}
                <label class="flex items-center gap-1.5 text-sm">
                  <input
                    class="checkbox"
                    type="checkbox"
                    bind:checked={confirmedNames[leader.key]}
                    disabled={busy}
                  />
                  <span>{$_('assistant.trainingPlan.confirmLeader')}</span>
                </label>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if rows.length > 0}
    <ol class="space-y-2">
      {#each rows as row, i (i)}
        {@const idle =
          row.input.skip ||
          row.input.saved ||
          row.status === 'exists' ||
          row.status === 'duplicate' ||
          (row.status === 'changed' && !row.input.overwrite)}
        <li
          class="card border p-3 space-y-2 {row.blocking && row.errors.length > 0
            ? 'border-error-500'
            : 'border-surface-200-800'}"
          class:opacity-70={idle && !editing[i]}
        >
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-xs text-surface-600-400 tabular-nums">{i + 1}.</span>
            {#if row.input.saved}
              <span class="badge text-xs preset-tonal-success">
                <Fa icon={faCheck} />
                <span>{$_('assistant.trainingPlan.saved')}</span>
              </span>
            {:else if !row.checked && !row.input.skip && row.errors.length === 0}
              <Fa icon={faSpinner} spin class="text-surface-600-400" />
            {:else}
              <span class="badge text-xs {STATUS_CLASS[row.status]}">{statusText(row.status)}</span>
            {/if}
            {#if row.entry.confidence === 'low'}
              <span class="badge text-xs preset-tonal-warning">
                {$_('assistant.review.uncertain')}
              </span>
            {/if}
            <span id="{uid}-date-{i}" class="font-semibold tabular-nums">
              {dateLabel(row.input.date)}
            </span>
            <span id="{uid}-training-{i}" class="min-w-0 truncate">
              {row.training ? trainingLabel(row.training) : $_('assistant.trainingPlan.noTraining')}
            </span>
            {#if !row.input.saved}
              <button
                type="button"
                class="btn btn-sm preset-tonal-surface ml-auto"
                aria-expanded={!!editing[i]}
                aria-describedby="{uid}-date-{i} {uid}-training-{i}"
                disabled={busy}
                onclick={() => (editing[i] = !editing[i])}
              >
                <Fa icon={editing[i] ? faChevronUp : faPen} />
                <span>{editing[i] ? $_('assistant.trainingPlan.editDone') : $_('button.edit')}</span
                >
              </button>
            {/if}
          </div>
          <p class="text-xs text-surface-600-400 break-words">
            {$_('assistant.trainingPlan.inDocument')}: {written(row.entry)}
          </p>
          {#if row.entry.remark}
            <p class="text-xs italic text-surface-600-400 break-words">{row.entry.remark}</p>
          {/if}

          {#if editing[i] && !row.input.saved}
            <div class="grid gap-2 sm:grid-cols-2 items-end">
              <label class="label">
                <span class="text-xs">{$_('page.trainingPlan.grid.date')}</span>
                <input
                  class="input text-sm"
                  type="date"
                  bind:value={inputs[i].date}
                  disabled={busy}
                />
              </label>
              <label class="label">
                <span class="text-xs">{$_('page.trainingPlan.training')}</span>
                <select
                  class="select text-sm"
                  bind:value={() => inputs[i].trainingId, (v) => setTraining(i, v)}
                  disabled={busy}
                >
                  <option value={null}>{$_('assistant.trainingPlan.pickTraining')}</option>
                  {#each trainings as t (t.id)}
                    <option value={t.id}>{trainingLabel(t)}</option>
                  {/each}
                </select>
              </label>
              <label class="label">
                <span class="text-xs">{$_('page.trainingPlan.trainer')}</span>
                <TrainerSelect
                  {members}
                  class="select text-sm"
                  disabled={busy || inputs[i].cancelled}
                  bind:value={() => inputs[i].trainerId, (v) => setTrainer(i, v)}
                />
              </label>
              <label class="label">
                <span class="text-xs">{$_('page.trainingPlan.topic')}</span>
                <input
                  class="input text-sm"
                  type="text"
                  maxlength={MAX_LENGTH.topic}
                  bind:value={inputs[i].topic}
                  disabled={busy || inputs[i].cancelled}
                />
              </label>
              <label class="label sm:col-span-2">
                <span class="text-xs">{$_('page.trainingPlan.notes')}</span>
                <input
                  class="input text-sm"
                  type="text"
                  maxlength={MAX_LENGTH.notes}
                  bind:value={inputs[i].notes}
                  disabled={busy}
                />
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input
                  class="checkbox"
                  type="checkbox"
                  bind:checked={inputs[i].cancelled}
                  disabled={busy}
                />
                <span>{$_('page.trainingPlan.cancelled')}</span>
              </label>
            </div>
          {:else if row.changes.length === 0 && row.status !== 'exists'}
            {@const shown = rowValues(row)}
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm">
              {#if shown.cancelled}
                <dt class="text-surface-600-400">{$_('page.trainingPlan.status.label')}</dt>
                <dd>{$_('page.trainingPlan.status.cancelled')}</dd>
              {:else}
                <dt class="text-surface-600-400">{$_('page.trainingPlan.trainer')}</dt>
                <dd class="break-words">{memberName(shown.trainer_id)}</dd>
                {#if shown.topic}
                  <dt class="text-surface-600-400">{$_('page.trainingPlan.topic')}</dt>
                  <dd class="break-words">{shown.topic}</dd>
                {/if}
              {/if}
              {#if shown.notes}
                <dt class="text-surface-600-400">{$_('page.trainingPlan.notes')}</dt>
                <dd class="break-words">{shown.notes}</dd>
              {/if}
            </dl>
          {/if}

          {#if row.changes.length > 0}
            <div class="text-sm">
              <p class="text-xs text-surface-600-400">
                {$_(
                  row.status === 'changed'
                    ? 'assistant.trainingPlan.changedHint'
                    : 'assistant.trainingPlan.fillHint'
                )}
              </p>
              <ul class="space-y-0.5">
                {#each row.changes as change (change.field)}
                  <li class="break-words" class:text-warning-800-200={change.conflict}>
                    <span class="text-surface-600-400">{fieldLabel(change.field)}:</span>
                    <span class:line-through={change.conflict}>{changeValue(change, 'from')}</span>
                    → <span class="font-semibold">{changeValue(change, 'to')}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if row.input.saved}
            <!-- Saved: nothing to choose any more -->
          {:else if row.status === 'exists'}
            <p class="text-xs text-surface-600-400">{$_('assistant.trainingPlan.exists')}</p>
          {:else if row.status === 'changed'}
            <label class="flex items-center gap-2 text-sm">
              <input
                class="checkbox"
                type="checkbox"
                bind:checked={inputs[i].overwrite}
                aria-describedby="{uid}-date-{i} {uid}-training-{i}"
                disabled={busy}
              />
              <span>{$_('assistant.trainingPlan.overwrite')}</span>
            </label>
          {:else if row.status === 'duplicate' && row.duplicateOf !== null}
            <p class="text-xs text-surface-600-400">
              {$_(
                row.input.trainingGuess === null
                  ? 'assistant.trainingPlan.duplicateOf'
                  : 'assistant.trainingPlan.guessDuplicateOf',
                { values: { row: row.duplicateOf + 1 } }
              )}
            </p>
          {/if}
          {#if !row.input.saved && (row.input.skip || row.status === 'new' || row.status === 'fill' || row.status === 'invalid')}
            <label class="flex items-center gap-2 text-sm">
              <input
                class="checkbox"
                type="checkbox"
                bind:checked={inputs[i].skip}
                aria-describedby="{uid}-date-{i} {uid}-training-{i}"
                disabled={busy}
              />
              <span>{$_('assistant.review.skip')}</span>
            </label>
          {/if}

          {#if row.errors.length > 0 || row.warnings.length > 0}
            <ul class="space-y-0.5 text-xs">
              {#each row.errors as issue (issue.code)}
                <li
                  class="flex flex-wrap items-center gap-1.5 {row.input.skip
                    ? 'text-surface-600-400'
                    : 'text-error-600-400'}"
                >
                  <Fa icon={faCircleExclamation} class="flex-none" />
                  <span class="min-w-0 flex-1">{issueText(issue)}</span>
                  {#if issue.code === 'trainerUnconfirmed' && !row.input.skip}
                    <button
                      type="button"
                      class="btn btn-sm preset-tonal-primary"
                      disabled={busy}
                      onclick={() => (confirmedNames[leaderKey(row.entry.trainer)] = true)}
                    >
                      <Fa icon={faCheck} />
                      <span>{$_('assistant.trainingPlan.confirmLeader')}</span>
                    </button>
                  {:else if issue.code === 'trainingUnconfirmed' && !row.input.skip && row.training}
                    {@const group = trainingGuessGroup(rows, i).length}
                    <button
                      type="button"
                      class="btn btn-sm preset-tonal-primary"
                      aria-describedby="{uid}-date-{i} {uid}-training-{i}"
                      disabled={busy}
                      onclick={() => confirmGuess(i)}
                    >
                      <Fa icon={faCheck} />
                      <span>
                        {group > 1
                          ? $_('assistant.trainingPlan.confirmTrainingGroup', {
                              values: { count: group, name: row.entry.trainingAsWritten }
                            })
                          : $_('assistant.trainingPlan.confirmTraining')}
                      </span>
                    </button>
                  {/if}
                </li>
              {/each}
              {#each row.warnings as issue (issue.code)}
                <li class="flex items-start gap-1.5 text-warning-800-200">
                  <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
                  <span>{issueText(issue)}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if sessionFailed[i]}
            <p
              class="flex items-start gap-1.5 text-xs {row.input.skip
                ? 'text-surface-600-400'
                : 'text-error-600-400'}"
            >
              <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
              <span>{$_('assistant.trainingPlan.saveFailed')}</span>
            </p>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if holidayRows.length > 0}
    <div>
      <p class="font-semibold text-sm">{$_('assistant.trainingPlan.holidays')}</p>
      <p class="text-xs text-surface-600-400 mb-2">{$_('assistant.trainingPlan.holidaysHint')}</p>
      <ul class="space-y-2">
        {#each holidayRows as h, i (i)}
          {@const locked = busy || h.input.saved}
          <li
            class="card border p-3 space-y-2 {h.blocking
              ? 'border-error-500'
              : 'border-surface-200-800'}"
            class:opacity-70={!h.write}
          >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {#if h.input.saved}
                <span class="badge text-xs preset-tonal-success">
                  <Fa icon={faCheck} />
                  <span>{$_('assistant.trainingPlan.saved')}</span>
                </span>
              {:else}
                <label class="flex items-center gap-2">
                  <input
                    class="checkbox"
                    type="checkbox"
                    bind:checked={holidayInputs[i].use}
                    aria-describedby="{uid}-holiday-{i}"
                    disabled={busy || h.status === 'exists' || h.status === 'provider'}
                  />
                  <span>{$_('assistant.trainingPlan.addHoliday')}</span>
                </label>
                <span class="badge text-xs {STATUS_CLASS[h.status]}">{statusText(h.status)}</span>
              {/if}
              <label class="flex items-center gap-1.5 ml-auto">
                <input
                  class="checkbox"
                  type="checkbox"
                  bind:checked={holidayInputs[i].closed}
                  aria-describedby="{uid}-holiday-{i}"
                  disabled={locked ||
                    !holidayInputs[i].use ||
                    h.status === 'exists' ||
                    h.status === 'provider'}
                />
                <span>{$_('page.trainingPlan.settings.closedShort')}</span>
              </label>
            </div>
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem] items-end">
              <label class="label">
                <span class="text-xs">{$_('page.trainingPlan.settings.breakTitle')}</span>
                <input
                  id="{uid}-holiday-{i}"
                  class="input text-sm"
                  type="text"
                  maxlength={MAX_LENGTH.heading}
                  bind:value={holidayInputs[i].title}
                  disabled={locked}
                />
              </label>
              <label class="label">
                <span class="text-xs">{$_('page.trainingPlan.from')}</span>
                <input
                  class="input text-sm"
                  type="date"
                  bind:value={holidayInputs[i].dateFrom}
                  disabled={locked}
                />
              </label>
              <label class="label">
                <span class="text-xs">{$_('page.trainingPlan.to')}</span>
                <input
                  class="input text-sm"
                  type="date"
                  min={holidayInputs[i].dateFrom}
                  bind:value={holidayInputs[i].dateTo}
                  disabled={locked}
                />
              </label>
            </div>
            {#if h.input.saved}
              <!-- Added: nothing to choose any more -->
            {:else if h.status === 'provider' && h.provider?.connection}
              <p class="text-xs text-surface-600-400">
                {$_('assistant.trainingPlan.holidayFromProvider', {
                  values: {
                    title: h.provider.title,
                    range: period(h.provider.date_from, h.provider.date_to),
                    provider: providerName(h.provider.connection)
                  }
                })}
              </p>
            {:else if h.status === 'exists'}
              <p class="text-xs text-surface-600-400">
                {$_('assistant.trainingPlan.holidayExists')}
              </p>
            {:else if h.status === 'duplicate' && h.duplicateOf !== null}
              <p class="text-xs text-surface-600-400">
                {$_('assistant.trainingPlan.holidayDuplicate', {
                  values: { row: h.duplicateOf + 1 }
                })}
              </p>
            {:else if h.status === 'new' && !h.input.use && h.overlaps.length > 0}
              <p class="text-xs text-surface-600-400">
                {$_('assistant.trainingPlan.holidayNotPreselected')}
              </p>
            {/if}
            {#if h.errors.length > 0 || h.overlaps.length > 0 || h.overlapsRows.length > 0}
              <ul class="space-y-0.5 text-xs">
                {#each h.errors as issue (issue.code)}
                  <li
                    class="flex items-start gap-1.5 {h.input.use
                      ? 'text-error-600-400'
                      : 'text-surface-600-400'}"
                  >
                    <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
                    <span>{holidayIssueText(issue)}</span>
                  </li>
                {/each}
                {#each h.overlaps as other, j (j)}
                  {@const closesOpen = h.closesOpen.includes(other)}
                  <li
                    class="flex items-start gap-1.5 text-warning-800-200"
                    class:font-semibold={closesOpen && h.input.use && !h.input.saved}
                  >
                    <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
                    <span>
                      {$_(
                        closesOpen
                          ? 'assistant.trainingPlan.holidayClosesOpen'
                          : 'assistant.trainingPlan.holidayOverlaps',
                        {
                          values: {
                            title: other.title,
                            range: period(other.date_from, other.date_to)
                          }
                        }
                      )}
                    </span>
                  </li>
                {/each}
                {#each h.overlapsRows as j (j)}
                  {@const other = holidayInputs[j]}
                  <li class="flex items-start gap-1.5 text-warning-800-200">
                    <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
                    <span>
                      {$_('assistant.trainingPlan.holidayOverlapsRow', {
                        values: {
                          row: j + 1,
                          title: other.title,
                          range: period(other.dateFrom, other.dateTo || other.dateFrom)
                        }
                      })}
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if holidayFailed[i]}
              <p
                class="flex items-start gap-1.5 text-xs {h.input.use
                  ? 'text-error-600-400'
                  : 'text-surface-600-400'}"
              >
                <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
                <span>{$_('assistant.trainingPlan.holidaySaveFailed')}</span>
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if count > 0}
    <p class="text-sm">
      {$_('assistant.trainingPlan.plan', {
        values: { sessions: summary.sessions, breaks: summary.breaks }
      })}
    </p>
  {/if}

  <footer class="flex flex-wrap items-center justify-end gap-2 pt-2">
    <p class="mr-auto text-xs text-surface-600-400" aria-live="polite">
      {#if progress}
        {$_('assistant.trainingPlan.progress', { values: progress })}
      {:else if loadFailed}
        {$_('assistant.trainingPlan.loadError')}
      {:else if failedCount > 0}
        {$_('assistant.trainingPlan.saveRetry', { values: { count: failedCount } })}
      {:else if summary.waiting > 0}
        {$_('assistant.trainingPlan.loading')}
      {:else if summary.blocking > 0}
        {$_('assistant.trainingPlan.blocked', { values: { count: summary.blocking } })}
      {:else if count === 0}
        {$_('assistant.review.nothing')}
      {/if}
    </p>
    {#if summary.blocking > 0 && !busy}
      <button type="button" class="btn preset-tonal-warning" onclick={skipAllIncomplete}>
        {$_('assistant.trainingPlan.skipIncomplete')}
      </button>
    {/if}
    <button type="button" class="btn preset-tonal-surface" onclick={onback} disabled={busy}>
      {$_('assistant.review.back')}
    </button>
    <button type="button" class="btn preset-tonal-surface" onclick={oncancel} disabled={busy}>
      <!-- After a partial save, leaving cancels nothing: what is saved stays -->
      {anySaved || attempted ? $_('button.close') : $_('button.cancel')}
    </button>
    <button
      type="button"
      class="btn preset-filled-primary-500"
      disabled={!canApply}
      onclick={apply}
    >
      {#if progress}
        <Fa icon={faSpinner} spin />
        <span>{$_('assistant.review.applying')}</span>
      {:else}
        <Fa icon={faCheck} />
        <span>{$_('assistant.review.apply', { values: { count } })}</span>
      {/if}
    </button>
  </footer>
</div>
