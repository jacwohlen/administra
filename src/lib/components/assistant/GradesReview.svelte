<script lang="ts">
  import { untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faCircleExclamation,
    faIdCard,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import { gradesBySection } from '$lib/gradeUtils';
  import type { GradeDefinition, MemberCurrentGrade, MemberGrade } from '$lib/models';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import {
    NOTE_MAX,
    buildGradeWrites,
    checkHolder,
    formatPassDate,
    hasDanGrade,
    initialInputs,
    initialSection,
    openSaveFailures,
    remapInputs,
    reviewGrades,
    summarizeGrades,
    type GradeIssue,
    type GradeRowInput,
    type GradeRowStatus,
    type GradeSaveFailure
  } from '$lib/assistant/grades';
  import { clubToday, isIsoDate } from '$lib/assistant/proposals';
  import type { GradeEntry, GradesProposal } from '$lib/assistant/types';

  /**
   * Review step of the Daten-Assistent for a Judo pass: every grading the
   * model read, mapped to the member's ladder and compared with what is
   * recorded. New gradings are saved like the manual "Prüfung erfassen"
   * form; recorded ones with another date are only corrected when the user
   * ticks it. The member record itself is never changed.
   *
   * When some writes fail, the review stays open: saved rows are marked and
   * left out, failed ones show why, and the member's gradings are reloaded
   * so the next try compares against what is really recorded.
   */
  let {
    proposal,
    memberId,
    member,
    definitions,
    current,
    history,
    onback,
    oncancel,
    onapplied,
    onpartial
  }: {
    proposal: GradesProposal;
    memberId: number;
    /** The profile the pass is read for, to check it is theirs */
    member: { firstname: string; lastname: string; birthday?: string | null };
    definitions: GradeDefinition[];
    current: MemberCurrentGrade[];
    history: MemberGrade[];
    onback: () => void;
    oncancel: () => void;
    /** Everything was saved: close the dialog and reload the member */
    onapplied: () => void;
    /**
     * Not everything was saved, the review stays open. `history` is what is
     * recorded now; the page has to reload the member when the dialog closes.
     */
    onpartial: (history: MemberGrade[]) => void;
  } = $props();

  const today = clubToday();

  /** The member's gradings as reloaded after a partial save */
  let reloaded = $state<MemberGrade[] | null>(null);
  let recorded = $derived(reloaded ?? history);
  /** Why a row's write failed in the last apply, by row */
  let failures = $state<Record<number, GradeSaveFailure>>({});
  /** An apply saved only part: leaving now closes the review, it cancels nothing */
  let attempted = $state(false);

  let ladders = $derived(gradesBySection(definitions));
  let sections = $derived([...ladders.keys()]);
  let section = $state(untrack(() => initialSection(proposal, ladders, current)));
  let ladder = $derived(ladders.get(section) ?? []);
  let inputs = $state<GradeRowInput[]>(
    untrack(() => initialInputs(proposal, section, ladders.get(section) ?? []))
  );

  let rows = $derived(
    reviewGrades(proposal.entries, inputs, {
      section,
      ladder,
      history: recorded,
      // Dans of every section: the black belt badge is one for all
      hasDan: hasDanGrade(recorded, definitions),
      birthday: member.birthday,
      today
    })
  );
  let summary = $derived(summarizeGrades(rows));
  let count = $derived(summary.inserts + summary.updates);
  let anySaved = $derived(inputs.some((input) => input.saved));
  /** Failures of the last apply for rows still to be saved */
  let openFailures = $derived(openSaveFailures(rows, failures));
  let failedCount = $derived(openFailures.filter(Boolean).length);

  let memberName = $derived(`${member.firstname} ${member.lastname}`);
  let holder = $derived(checkHolder(proposal.holder, member));
  let holderDoubt = $derived(holder.nameFits === false || holder.birthdayFits === false);
  let holderConfirmed = $state(false);

  let progress = $state<{ done: number; total: number } | null>(null);
  let canApply = $derived(
    progress === null && count > 0 && summary.blocking === 0 && (!holderDoubt || holderConfirmed)
  );

  const STATUS_CLASS: Record<GradeRowStatus, string> = {
    new: 'preset-tonal-success',
    exists: 'preset-tonal-surface',
    changed: 'preset-tonal-warning',
    duplicate: 'preset-tonal-surface',
    invalid: 'preset-tonal-error'
  };

  function changeSection(value: string) {
    const from = section;
    section = value;
    inputs = remapInputs(proposal.entries, inputs, {
      from,
      to: value,
      ladder: ladders.get(value) ?? []
    });
  }

  function formatDate(date: string): string {
    return isIsoDate(date) ? dayjs(date).format('DD.MM.YYYY') : date;
  }

  /** What the model read, as plain text */
  function written(entry: GradeEntry): string {
    return [
      entry.gradeAsWritten || entry.grade,
      entry.beltColor,
      entry.date ? formatPassDate(entry.date) : '',
      entry.examiner
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function issueText(issue: GradeIssue): string {
    return $_(`assistant.grades.issues.${issue.code}`, {
      values: { ...issue, badgeName: $_('badges.black_belt.name') }
    });
  }

  /** What is recorded now, so rows that did go through show as recorded */
  async function reload() {
    try {
      const { data, error } = await supabaseClient
        .from('member_grades')
        .select('id, memberId, section, grade, examDate, note')
        .eq('memberId', memberId);
      if (error) throw error;
      reloaded = (data ?? []) as MemberGrade[];
    } catch (err) {
      // Keep the last known gradings; saved rows stay marked and are not written again
      console.error('Error reloading gradings after saving from the assistant:', err);
    }
  }

  async function apply() {
    if (!canApply) return;
    const writes = buildGradeWrites(memberId, rows, { section, ladder, history: recorded, today });
    const total = writes.inserts.length + writes.corrections.length;
    if (total === 0) {
      // The last check dropped every row; say so instead of doing nothing
      toaster.error({ title: $_('assistant.review.error') });
      return;
    }
    progress = { done: 0, total };
    failures = {};
    const failed: Record<number, GradeSaveFailure> = {};
    const written: number[] = [];
    // One by one: each row succeeds or fails on its own, and the badge
    // trigger runs per grading anyway
    for (const { row, values } of writes.inserts) {
      try {
        // Recorded in the meantime (e.g. by a Q-Prüfung): nothing comes back, nothing changes
        const { data, error } = await supabaseClient
          .from('member_grades')
          .upsert([values], { onConflict: 'memberId,section,grade', ignoreDuplicates: true })
          .select('id');
        if (error) throw error;
        if ((data?.length ?? 0) > 0) written.push(row);
      } catch (err) {
        console.error('Error saving grading from the assistant:', err);
        failed[row] = 'failed';
      }
      progress.done++;
    }
    for (const { row, values } of writes.corrections) {
      try {
        const { data, error } = await supabaseClient
          .from('member_grades')
          .update({ examDate: values.examDate })
          .eq('id', values.id)
          .eq('memberId', memberId)
          .select('id');
        if (error) throw error;
        // No row back: RLS stopped it or the grading was removed meanwhile
        if ((data?.length ?? 0) === 0) {
          failed[row] = 'notUpdated';
        } else {
          written.push(row);
        }
      } catch (err) {
        console.error('Error correcting a grading date from the assistant:', err);
        failed[row] = 'failed';
      }
      progress.done++;
    }

    const saved = written.length;
    const failedTotal = Object.keys(failed).length;
    if (failedTotal === 0) {
      toaster.success({ title: $_('assistant.review.done', { values: { count: saved } }) });
      onapplied();
      return;
    }
    // Not everything went through. Saved rows are never written again, failed
    // ones say so, and what is recorded is read again (a write can commit and
    // still report an error). While something is missing, the review stays
    // open to retry or close.
    for (const row of written) inputs[row].saved = true;
    failures = failed;
    await reload();
    progress = null;
    // Failed rows the reload shows as recorded on that date went through after all
    const stillFailed = rows.filter((r, i) => failed[i] && r.status !== 'exists').length;
    const savedNow = saved + failedTotal - stillFailed;
    if (stillFailed === 0) {
      toaster.success({ title: $_('assistant.review.done', { values: { count: savedNow } }) });
      onapplied();
      return;
    }
    attempted = true;
    onpartial(recorded);
    if (savedNow > 0) {
      toaster.warning({
        title: $_('assistant.review.partial', { values: { saved: savedNow, failed: stillFailed } })
      });
    } else {
      toaster.error({ title: $_('assistant.review.error') });
    }
  }
</script>

<div class="space-y-4">
  {#if holder.name || holder.birthday}
    <div
      class="p-3 rounded-lg text-sm space-y-2 {holderDoubt
        ? 'preset-tonal-error'
        : 'preset-tonal-surface'}"
      role={holderDoubt ? 'alert' : undefined}
    >
      <div class="flex items-start gap-2">
        <Fa icon={holderDoubt ? faTriangleExclamation : faIdCard} class="mt-0.5 flex-none" />
        <div class="min-w-0 space-y-0.5">
          {#if holderDoubt}
            <p class="font-semibold">
              {$_('assistant.grades.holder.doubt', { values: { name: memberName } })}
            </p>
          {/if}
          <p>
            <span class="text-surface-600-400">{$_('assistant.grades.inPass')}:</span>
            {#if holder.name}
              <span class:font-semibold={holder.nameFits === false}>«{holder.name}»</span>
            {/if}
            {#if holder.birthday}
              <span class:font-semibold={holder.birthdayFits === false}>
                · {formatDate(holder.birthday)}
              </span>
            {/if}
          </p>
          <p>
            <span class="text-surface-600-400">{$_('assistant.grades.inProfile')}:</span>
            {memberName}
            {#if member.birthday}· {formatDate(member.birthday)}{/if}
          </p>
        </div>
      </div>
      {#if holderDoubt}
        <label class="flex items-center gap-2">
          <input class="checkbox" type="checkbox" bind:checked={holderConfirmed} />
          <span>{$_('assistant.grades.holder.confirm', { values: { name: memberName } })}</span>
        </label>
        <p class="text-xs">{$_('assistant.grades.holder.profileUnchanged')}</p>
      {/if}
    </div>
  {:else}
    <p class="flex items-start gap-2 text-sm text-surface-600-400">
      <Fa icon={faIdCard} class="mt-0.5 flex-none" />
      <span>{$_('assistant.grades.holder.unknown', { values: { name: memberName } })}</span>
    </p>
  {/if}

  <div class="flex flex-wrap items-end gap-3">
    {#if sections.length > 1}
      <label class="label w-auto">
        <span class="text-sm">{$_('grades.section')}</span>
        <select
          class="select text-sm"
          value={section}
          disabled={progress !== null || anySaved}
          onchange={(e) => changeSection(e.currentTarget.value)}
        >
          {#each sections as s (s)}
            <option value={s}>{s}</option>
          {/each}
        </select>
      </label>
    {/if}
    <div class="flex flex-wrap gap-1.5 text-xs">
      {#each Object.entries(summary.byStatus) as [status, n] (status)}
        {#if n > 0}
          <span class="badge {STATUS_CLASS[status as GradeRowStatus]}">
            {n} × {$_(`assistant.review.status.${status}`)}
          </span>
        {/if}
      {/each}
    </div>
  </div>

  {#if rows.length === 0}
    <p class="text-sm text-surface-600-400">{$_('assistant.grades.empty')}</p>
  {:else}
    <ol class="space-y-2">
      {#each rows as row, i (i)}
        {@const idle =
          row.input.skip ||
          row.input.saved ||
          row.status === 'exists' ||
          row.status === 'duplicate'}
        {@const locked = progress !== null || row.input.saved}
        {@const failure = openFailures[i]}
        <li
          class="card border p-3 space-y-2 {row.blocking || failure
            ? 'border-error-500'
            : 'border-surface-200-800'}"
          class:opacity-70={idle && !failure}
        >
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-xs text-surface-600-400 tabular-nums">{i + 1}.</span>
            {#if row.input.saved}
              <span class="badge text-xs preset-filled-success-500">
                <Fa icon={faCheck} />
                <span>{$_('assistant.grades.saved')}</span>
              </span>
            {:else}
              <span class="badge text-xs {STATUS_CLASS[row.status]}">
                {$_(`assistant.review.status.${row.status}`)}
              </span>
            {/if}
            {#if row.entry.confidence === 'low'}
              <span class="badge text-xs preset-tonal-warning">
                {$_('assistant.review.uncertain')}
              </span>
            {/if}
            <span class="min-w-0 break-words text-surface-600-400">
              {$_('assistant.grades.inPass')}: {written(row.entry)}
            </span>
          </div>
          {#if row.entry.remark}
            <p class="text-xs italic text-surface-600-400 break-words">{row.entry.remark}</p>
          {/if}

          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)] items-end">
            <label class="label">
              <span class="text-xs">{$_('grades.grade')}</span>
              <span class="flex items-center gap-2">
                {#if row.definition}
                  <BeltStrip
                    color={row.definition.beltColor}
                    color2={row.definition.beltColor2}
                    isDan={row.definition.isDan}
                    grade={row.definition.grade}
                  />
                {/if}
                <select class="select text-sm" bind:value={inputs[i].grade} disabled={locked}>
                  <option value="">{$_('assistant.grades.pickGrade')}</option>
                  {#each ladder as d (d.grade)}
                    <option value={d.grade}>{d.grade}</option>
                  {/each}
                </select>
              </span>
            </label>
            <label class="label">
              <span class="text-xs">{$_('grades.examDate')}</span>
              <input
                class="input text-sm"
                type="date"
                max={today}
                bind:value={inputs[i].examDate}
                disabled={locked}
              />
            </label>
            {#if row.status === 'new' || row.status === 'invalid'}
              <label class="label">
                <span class="text-xs">{$_('grades.note')}</span>
                <input
                  class="input text-sm"
                  type="text"
                  maxlength={NOTE_MAX}
                  bind:value={inputs[i].note}
                  disabled={locked}
                />
              </label>
            {/if}
          </div>

          {#if row.status === 'exists' && row.existing}
            <p class="text-xs text-surface-600-400">
              {$_('assistant.grades.recordedOn', {
                values: { date: formatDate(row.existing.examDate) }
              })}
            </p>
          {:else if row.status === 'changed' && row.existing}
            {@const recordedId = row.existing.id}
            <label class="flex items-start gap-2 text-sm">
              <!-- The tick belongs to this recorded grading, not to the row -->
              <input
                class="checkbox mt-0.5"
                type="checkbox"
                checked={row.input.correctId === recordedId}
                onchange={(e) =>
                  (inputs[i].correctId = e.currentTarget.checked ? recordedId : null)}
                disabled={locked}
              />
              <span>
                {$_('assistant.grades.correct', {
                  values: {
                    recorded: formatDate(row.existing.examDate),
                    date: row.input.examDate ? formatDate(row.input.examDate) : '…'
                  }
                })}
              </span>
            </label>
          {:else if row.status === 'duplicate' && row.duplicateOf !== null}
            <p class="text-xs text-surface-600-400">
              {$_('assistant.grades.duplicateOf', { values: { row: row.duplicateOf + 1 } })}
            </p>
          {/if}
          {#if !row.input.saved && (row.status === 'new' || row.status === 'invalid' || row.input.skip)}
            <label class="flex items-center gap-2 text-sm">
              <input
                class="checkbox"
                type="checkbox"
                bind:checked={inputs[i].skip}
                disabled={locked}
              />
              <span>{$_('assistant.review.skip')}</span>
            </label>
          {/if}
          {#if failure}
            <p class="flex items-start gap-1.5 text-xs text-error-600-400">
              <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
              <span>{$_(`assistant.grades.saveFailed.${failure}`)}</span>
            </p>
          {/if}

          {#if row.errors.length > 0 || row.warnings.length > 0}
            <ul class="space-y-0.5 text-xs">
              {#each row.errors as issue (issue.code)}
                <li class="flex items-start gap-1.5 text-error-600-400">
                  <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
                  <span>{issueText(issue)}</span>
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
        </li>
      {/each}
    </ol>
  {/if}

  {#if count > 0}
    <p class="text-sm">
      {$_('assistant.grades.plan', {
        values: { inserts: summary.inserts, updates: summary.updates }
      })}
    </p>
  {/if}

  <footer class="flex flex-wrap items-center justify-end gap-2 pt-2">
    <p class="mr-auto text-xs text-surface-600-400" aria-live="polite">
      {#if progress}
        {$_('assistant.grades.progress', { values: progress })}
      {:else if holderDoubt && !holderConfirmed}
        {$_('assistant.grades.confirmFirst')}
      {:else if summary.blocking > 0}
        {$_('assistant.grades.blocked', { values: { count: summary.blocking } })}
      {:else if failedCount > 0}
        {$_('assistant.grades.retry', { values: { count: failedCount } })}
      {:else if count === 0}
        {$_('assistant.review.nothing')}
      {/if}
    </p>
    <button
      type="button"
      class="btn preset-tonal-surface"
      onclick={onback}
      disabled={progress !== null}
    >
      {$_('assistant.review.back')}
    </button>
    <button
      type="button"
      class="btn preset-tonal-surface"
      onclick={oncancel}
      disabled={progress !== null}
    >
      {attempted ? $_('button.close') : $_('button.cancel')}
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
