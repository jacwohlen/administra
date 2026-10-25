<script lang="ts">
  import { untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faCheck,
    faCircleExclamation,
    faClone,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { clubConfig } from '$lib/clubConfig';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import {
    buildEventInserts,
    eventDescription,
    formatDay,
    initialDefaultSection,
    initialInputs,
    insertEvents,
    preselect,
    reviewEvents,
    summarizeEvents,
    type EventIssue,
    type EventReviewRow,
    type EventRowInput,
    type EventRowStatus,
    type KnownEvent
  } from '$lib/assistant/events';
  import { isIsoDate, MAX_LENGTH } from '$lib/assistant/proposals';
  import type { EventsProposal } from '$lib/assistant/types';

  /**
   * Review step of the Daten-Assistent for club dates: one editable row per
   * date read, checked against the events already recorded. Ticked rows
   * become new events with the columns of the "Event erstellen" form;
   * likely duplicates stay unticked and existing events are never changed.
   */
  let {
    proposal,
    known,
    onback,
    oncancel,
    onapplied
  }: {
    proposal: EventsProposal;
    /** The events already recorded, as the events list loaded them */
    known: KnownEvent[];
    onback: () => void;
    oncancel: () => void;
    /** Something was saved: close the dialog and reload the list */
    onapplied: () => void;
  } = $props();

  const today = dayjs().format('YYYY-MM-DD');
  const sections = clubConfig.sections;

  let defaultSection = $state(initialDefaultSection(sections));
  // Default selection fixed once: later edits never untick (and fold away) a row
  let inputs = $state<EventRowInput[]>(
    untrack(() => {
      const initial = initialInputs(proposal, sections);
      const ctx = { known, sections, defaultSection, today };
      return preselect(initial, reviewEvents(proposal.events, initial, ctx));
    })
  );
  let rows = $derived(
    reviewEvents(proposal.events, inputs, { known, sections, defaultSection, today })
  );
  let summary = $derived(summarizeEvents(rows));
  let count = $derived(summary.inserts);
  let multiDay = $derived(rows.some((r) => r.input.dateTo));

  let progress = $state<{ done: number; total: number } | null>(null);
  let busy = $derived(progress !== null);
  let canApply = $derived(!busy && count > 0 && summary.blocking === 0);

  const STATUS_CLASS: Record<EventRowStatus, string> = {
    new: 'preset-tonal-success',
    duplicate: 'preset-tonal-surface',
    invalid: 'preset-tonal-error'
  };

  function formatDate(date: string): string {
    return isIsoDate(date) ? formatDay(date) : date;
  }

  /** First line of a multi-day event's description */
  function untilLine(dateTo: string): string {
    return $_('assistant.events.untilLine', { values: { date: formatDay(dateTo) } });
  }

  function has(row: EventReviewRow, ...codes: EventIssue['code'][]): boolean {
    return row.errors.some((e) => codes.includes(e.code));
  }

  function issueText(issue: EventIssue): string {
    return $_(`assistant.events.issues.${issue.code}`, { values: { ...issue } });
  }

  /** The row in one line, for rows that are not created */
  function summaryLine(input: EventRowInput, section: string): string {
    return [
      input.title,
      input.date ? formatDate(input.date) : '',
      input.dateTo ? `– ${formatDate(input.dateTo)}` : '',
      [input.timeFrom, input.timeTo].filter(Boolean).join('–'),
      input.location,
      section
    ]
      .filter(Boolean)
      .join(' · ');
  }

  async function apply() {
    if (!canApply) return;
    const writes = buildEventInserts(rows, sections, untilLine);
    if (writes.length === 0) return;
    progress = { done: 0, total: writes.length };
    // One by one, like the event form: each row succeeds or fails on its own
    const outcome = await insertEvents(
      writes,
      (row) => supabaseClient.from('events').insert(row).select('id').single(),
      (done) => {
        if (progress) progress.done = done;
      }
    );
    const saved = outcome.saved.length;
    const failed = outcome.failed.length;

    if (failed === 0) {
      toaster.success({ title: $_('assistant.review.done', { values: { count: saved } }) });
    } else if (saved > 0) {
      toaster.warning({ title: $_('assistant.review.partial', { values: { saved, failed } }) });
    } else {
      // Nothing saved: keep the review open to try again
      toaster.error({ title: $_('assistant.review.error') });
      progress = null;
      return;
    }
    onapplied();
  }
</script>

<div class="space-y-4">
  <p class="text-sm">{$_('assistant.events.intro', { values: { count: rows.length } })}</p>

  <div class="flex flex-wrap items-end gap-3">
    {#if sections.length > 1}
      <label class="label w-auto">
        <span class="text-sm">{$_('assistant.events.defaultSection')}</span>
        <select class="select text-sm" bind:value={defaultSection} disabled={busy}>
          <option value="">{$_('assistant.events.defaultSectionNone')}</option>
          {#each sections as s (s)}
            <option value={s}>{s}</option>
          {/each}
        </select>
      </label>
    {/if}
    <div class="flex flex-wrap gap-1.5 text-xs">
      {#each Object.entries(summary.byStatus) as [status, n] (status)}
        {#if n > 0}
          <span class="badge {STATUS_CLASS[status as EventRowStatus]}">
            {n} × {$_(`assistant.review.status.${status}`)}
          </span>
        {/if}
      {/each}
    </div>
  </div>

  {#if multiDay}
    <p class="flex items-start gap-2 p-3 rounded-lg preset-tonal-surface text-sm">
      <Fa icon={faCalendarDays} class="mt-0.5 flex-none" />
      <span>{$_('assistant.events.multiDayInfo')}</span>
    </p>
  {/if}

  {#if rows.length === 0}
    <p class="text-sm text-surface-600-400">{$_('assistant.events.empty')}</p>
  {:else}
    <ol class="space-y-2">
      {#each rows as row, i (i)}
        {@const input = row.input}
        <li
          class="card border p-3 space-y-2 {row.blocking
            ? 'border-error-500'
            : 'border-surface-200-800'}"
          class:opacity-70={!row.selected}
        >
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-xs text-surface-600-400 tabular-nums">{i + 1}.</span>
            <span class="badge text-xs {STATUS_CLASS[row.status]}">
              {$_(`assistant.review.status.${row.status}`)}
            </span>
            {#if row.entry.confidence === 'low'}
              <span class="badge text-xs preset-tonal-warning">
                {$_('assistant.review.uncertain')}
              </span>
            {/if}
            {#if row.input.dateTo}
              <span class="badge text-xs preset-tonal-secondary">
                {$_('assistant.events.multiDay')}
              </span>
            {/if}
            <label class="ml-auto flex items-center gap-2">
              <input
                class="checkbox"
                type="checkbox"
                checked={row.selected}
                onchange={(e) => (inputs[i].include = e.currentTarget.checked)}
                disabled={busy}
              />
              <span>
                {row.status === 'duplicate'
                  ? $_('assistant.events.includeAnyway')
                  : $_('assistant.events.include')}
              </span>
            </label>
          </div>
          {#if row.entry.remark}
            <p class="text-xs italic text-surface-600-400 break-words">{row.entry.remark}</p>
          {/if}

          {#if row.duplicate?.kind === 'existing'}
            {@const event = row.duplicate.event}
            <div class="flex items-start gap-2 p-2 rounded-lg preset-tonal-surface text-xs">
              <Fa icon={faClone} class="mt-0.5 flex-none" />
              <div class="min-w-0 space-y-0.5 break-words">
                <p>
                  {$_('assistant.events.duplicateOf', {
                    values: { title: event.title, date: formatDate(event.date) }
                  })}
                  {#if event.timeFrom}· {event.timeFrom}{/if}
                  {#if event.location}· {event.location}{/if}
                </p>
                {#if row.duplicate.webling}
                  <p class="font-semibold">{$_('assistant.events.fromWebling')}</p>
                {/if}
              </div>
            </div>
          {:else if row.duplicate?.kind === 'row'}
            <p class="flex items-start gap-2 text-xs text-surface-600-400">
              <Fa icon={faClone} class="mt-0.5 flex-none" />
              <span>
                {$_('assistant.events.duplicateOfRow', {
                  values: { row: row.duplicate.index + 1 }
                })}
              </span>
            </p>
          {/if}

          {#if row.selected}
            <div class="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
              <label class="label sm:col-span-2 md:col-span-4">
                <span class="text-xs">{$_('page.events.form.title')} *</span>
                <input
                  class="input text-sm"
                  class:border-error-500={has(row, 'noTitle')}
                  aria-invalid={has(row, 'noTitle')}
                  type="text"
                  maxlength={MAX_LENGTH.title}
                  bind:value={inputs[i].title}
                  disabled={busy}
                />
              </label>
              <label class="label">
                <span class="text-xs">{$_('page.events.form.date')} *</span>
                <input
                  class="input text-sm"
                  class:border-error-500={has(row, 'noDate', 'badDate')}
                  aria-invalid={has(row, 'noDate', 'badDate')}
                  type="date"
                  bind:value={inputs[i].date}
                  disabled={busy}
                />
              </label>
              <label class="label">
                <span class="text-xs">{$_('assistant.events.dateTo')}</span>
                <input
                  class="input text-sm"
                  class:border-error-500={has(row, 'badDateTo')}
                  aria-invalid={has(row, 'badDateTo')}
                  type="date"
                  min={input.date || undefined}
                  bind:value={inputs[i].dateTo}
                  disabled={busy}
                />
              </label>
              <label class="label">
                <span class="text-xs">{$_('page.events.form.time_from')}</span>
                <input
                  class="input text-sm"
                  class:border-error-500={has(row, 'badTimeFrom')}
                  aria-invalid={has(row, 'badTimeFrom')}
                  type="time"
                  bind:value={inputs[i].timeFrom}
                  disabled={busy}
                />
              </label>
              <label class="label">
                <span class="text-xs">{$_('page.events.form.time_to')}</span>
                <input
                  class="input text-sm"
                  class:border-error-500={has(row, 'badTimeTo', 'timeOrder')}
                  aria-invalid={has(row, 'badTimeTo', 'timeOrder')}
                  type="time"
                  bind:value={inputs[i].timeTo}
                  disabled={busy}
                />
              </label>
              <label class="label md:col-span-2">
                <span class="text-xs">{$_('page.events.form.location')}</span>
                <input
                  class="input text-sm"
                  type="text"
                  maxlength={MAX_LENGTH.location}
                  bind:value={inputs[i].location}
                  disabled={busy}
                />
              </label>
              <label class="label md:col-span-2">
                <span class="text-xs">{$_('page.events.form.section')} *</span>
                <select
                  class="select text-sm"
                  class:border-error-500={has(row, 'noSection', 'unknownSection')}
                  aria-invalid={has(row, 'noSection', 'unknownSection')}
                  bind:value={inputs[i].section}
                  disabled={busy}
                >
                  <option value="">
                    {defaultSection
                      ? $_('assistant.events.useDefault', { values: { section: defaultSection } })
                      : $_('page.events.form.select_section')}
                  </option>
                  {#each sections as s (s)}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </label>
              <div class="space-y-1 sm:col-span-2 md:col-span-4">
                <label class="label">
                  <span class="text-xs">{$_('page.events.form.description')}</span>
                  <textarea
                    class="textarea text-sm"
                    rows="2"
                    maxlength={MAX_LENGTH.description}
                    bind:value={inputs[i].description}
                    disabled={busy}
                  ></textarea>
                </label>
                {#if input.dateTo && !has(row, 'badDateTo', 'noDate', 'badDate')}
                  {@const description = eventDescription(input, untilLine)}
                  <p class="text-xs text-surface-600-400 break-words">
                    {$_('assistant.events.descriptionStarts', {
                      values: { line: description.split('\n')[0] }
                    })}
                  </p>
                {/if}
              </div>
            </div>
          {:else}
            <p class="text-sm break-words">{summaryLine(input, row.section)}</p>
          {/if}

          {#if row.selected && (row.errors.length > 0 || row.warnings.length > 0)}
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

  <footer class="flex flex-wrap items-center justify-end gap-2 pt-2">
    <p class="mr-auto text-xs text-surface-600-400" aria-live="polite">
      {#if progress}
        {$_('assistant.events.progress', { values: progress })}
      {:else if summary.blocking > 0}
        {$_('assistant.events.blocked', { values: { count: summary.blocking } })}
      {:else if count === 0}
        {$_('assistant.review.nothing')}
      {/if}
    </p>
    <button type="button" class="btn preset-tonal-surface" onclick={onback} disabled={busy}>
      {$_('assistant.review.back')}
    </button>
    <button type="button" class="btn preset-tonal-surface" onclick={oncancel} disabled={busy}>
      {$_('button.cancel')}
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
