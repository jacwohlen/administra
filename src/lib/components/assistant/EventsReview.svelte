<script lang="ts">
  import { untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faCheck,
    faCircleExclamation,
    faClone,
    faRotateRight,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import { clubConfig } from '$lib/clubConfig';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { fetchAllRows } from '$lib/assistant/attendance';
  import {
    buildEventInserts,
    comparisonSpan,
    eventDescription,
    formatDay,
    initialDefaultSection,
    initialInputs,
    insertEvents,
    markSaved,
    preselect,
    reviewEvents,
    spanCovers,
    summarizeEvents,
    untickRecorded,
    type ComparisonSet,
    type DateSpan,
    type EventIssue,
    type EventReviewRow,
    type EventRowInput,
    type EventRowStatus,
    type KnownEvent
  } from '$lib/assistant/events';
  import { clubToday, isIsoDate, MAX_LENGTH } from '$lib/assistant/proposals';
  import type { EventsProposal } from '$lib/assistant/types';

  /**
   * Review step of the Daten-Assistent for club dates: one editable row per
   * date read, checked against the events already recorded. Ticked rows
   * become new events with the columns of the "Event erstellen" form;
   * likely duplicates stay unticked and existing events are never changed.
   *
   * The events to compare with are loaded here, all of them for the days
   * the rows need (the list page's own load stops at 1000 rows), and again
   * when an edited date leaves those days; nothing is saved before they
   * are in. When some inserts fail, the review stays open: saved rows are
   * marked and never written again, the events are loaded again so a row
   * that went through despite an error shows as a duplicate, and the
   * failed ones can be retried.
   */
  let {
    proposal,
    known,
    onback,
    oncancel,
    onapplied,
    onpartial
  }: {
    proposal: EventsProposal;
    /** The events the list page loaded: shown until the review's own comparison set is in */
    known: KnownEvent[];
    onback: () => void;
    oncancel: () => void;
    /** Everything was saved: close the dialog and reload the list */
    onapplied: () => void;
    /**
     * Not everything was saved (a failed insert may still have gone
     * through), the review stays open: the page reloads its list on close
     */
    onpartial: () => void;
  } = $props();

  const today = clubToday();
  const sections = clubConfig.sections;

  let defaultSection = $state(initialDefaultSection(sections));

  // ----- Events to compare with -----

  /** The events recorded on the days of `span`, as loaded last */
  let loaded = $state.raw<ComparisonSet | null>(null);
  let loading = $state(false);
  let loadFailed = $state(false);
  /** Days of the load started last (it may still run or have failed) */
  let requested: DateSpan | null = null;
  let loadSeq = 0;
  let compared = $derived(loaded?.events ?? known);

  function ctxFor(events: readonly KnownEvent[]) {
    return { known: events, sections, defaultSection, today };
  }

  // Default selection fixed once, against the complete comparison set: later
  // edits never untick (and fold away) a row
  const initial = untrack(() => initialInputs(proposal, sections));
  let preselected = comparisonSpan(initial) === null;
  let inputs = $state<EventRowInput[]>(
    preselected
      ? untrack(() => preselect(initial, reviewEvents(proposal.events, initial, ctxFor(known))))
      : initial
  );

  /** After a partial save: failed rows to check against the next load */
  let recheck: {
    failed: number[];
    before: ComparisonSet;
    created: (string | number)[];
  } | null = null;

  let rows = $derived(reviewEvents(proposal.events, inputs, ctxFor(compared)));
  let summary = $derived(summarizeEvents(rows));
  let count = $derived(summary.inserts);
  let multiDay = $derived(rows.some((r) => r.input.dateTo));

  let span = $derived(comparisonSpan(inputs));
  // Primitives, so typing in a title does not start a load
  let spanFrom = $derived(span?.from ?? '');
  let spanTo = $derived(span?.to ?? '');
  let covered = $derived(spanCovers(loaded?.span ?? null, span));

  // ----- Saving -----

  let progress = $state<{ done: number; total: number } | null>(null);
  let busy = $derived(progress !== null);
  /** Rows whose insert failed in the last apply */
  let failures = $state<number[]>([]);
  /** Failed rows the reload shows as recorded after all (unticked) */
  let recorded = $state<number[]>([]);
  /** An apply saved only part: leaving now closes the review, it cancels nothing */
  let attempted = $state(false);
  let openFailures = $derived(
    failures.filter((i) => !recorded.includes(i) && rows[i]?.selected && !rows[i].input.saved)
  );
  // Only against a complete, current comparison set (also after a partial save)
  let canApply = $derived(
    !busy && covered && !loading && !loadFailed && count > 0 && summary.blocking === 0
  );

  const STATUS_CLASS: Record<EventRowStatus, string> = {
    new: 'preset-tonal-success',
    duplicate: 'preset-tonal-surface',
    invalid: 'preset-tonal-error',
    saved: 'preset-filled-success-500'
  };

  async function loadKnown(days: DateSpan) {
    const seq = ++loadSeq;
    requested = days;
    loading = true;
    loadFailed = false;
    try {
      // events has no end date: an event's date is its first day
      const events = await fetchAllRows<KnownEvent>((from, to) =>
        supabaseClient
          .from('events')
          .select('id, title, date, timeFrom, location, description')
          .gte('date', days.from)
          .lte('date', days.to)
          .order('id')
          .range(from, to)
      );
      if (seq !== loadSeq) return;
      loaded = { span: days, events };
      settle(events);
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error('Error loading the events to compare the assistant with:', err);
      loadFailed = true;
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  /** First load: fix the default selection; after a partial save: untick what went through */
  function settle(events: KnownEvent[]) {
    let next = inputs;
    if (!preselected) {
      next = preselect(next, reviewEvents(proposal.events, next, ctxFor(events)));
      preselected = true;
    }
    if (recheck) {
      const result = untickRecorded(next, recheck.failed, recheck.before, events, recheck.created);
      next = result.inputs;
      recorded = result.recorded;
      recheck = null;
    }
    if (next !== inputs) inputs = next;
  }

  function retryLoad() {
    const days = comparisonSpan(inputs);
    if (days) loadKnown(days);
  }

  // Load the days the rows need, again when an edited date leaves them
  $effect(() => {
    const from = spanFrom;
    const to = spanTo;
    if (!from) return;
    untrack(() => {
      const days = { from, to };
      // A load for these days runs or failed (then the user retries)
      if (spanCovers(requested, days)) return;
      loadKnown(days);
    });
  });

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

  function warns(row: EventReviewRow, code: EventIssue['code']): boolean {
    return row.warnings.some((w) => w.code === code);
  }

  function statusLabel(status: EventRowStatus): string {
    return status === 'saved'
      ? $_('assistant.events.saved')
      : $_(`assistant.review.status.${status}`);
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
    // canApply implies the comparison set for the rows' days is loaded
    const before = loaded;
    if (!canApply || !before) return;
    const writes = buildEventInserts(rows, sections, untilLine);
    if (writes.length === 0) return;
    failures = [];
    recorded = [];
    progress = { done: 0, total: writes.length };
    // One by one, like the event form: each row succeeds or fails on its own
    const outcome = await insertEvents(
      writes,
      (values) => supabaseClient.from('events').insert(values).select('id').single(),
      (done) => {
        if (progress) progress.done = done;
      }
    );
    const saved = outcome.saved.length;
    const failed = outcome.failed.length;

    if (failed === 0) {
      toaster.success({ title: $_('assistant.review.done', { values: { count: saved } }) });
      onapplied();
      return;
    }

    // Not everything went through: keep the review open to retry or close.
    // Saved rows are never written again, failed ones say so, and the
    // events are loaded again (an insert can commit and still report an error).
    const savedRows = outcome.saved.map((w) => w.row);
    inputs = markSaved(inputs, savedRows);
    failures = outcome.failed.map((w) => w.row);
    attempted = true;
    // Something may be written now: the page reloads its list however the review is left
    onpartial();
    recheck = { failed: failures, before, created: outcome.created };
    // Apply stays disabled until this load is in (retry offered if it fails)
    const days = comparisonSpan(inputs);
    if (days) await loadKnown(days);
    else recheck = null;
    progress = null;
    // Named: the ones that are still missing after the reload. Rows the
    // reload found recorded went through after all and are counted so.
    const missing = loadFailed
      ? outcome.failed
      : outcome.failed.filter((w) => !recorded.includes(w.row));
    const savedNow = saved + failed - missing.length;
    if (missing.length === 0) {
      toaster.success({ title: $_('assistant.review.done', { values: { count: savedNow } }) });
      onapplied();
      return;
    }
    const description = $_('assistant.events.failedTitles', {
      values: { titles: missing.map((w) => `«${w.values.title}»`).join(', ') }
    });
    if (savedNow > 0) {
      toaster.warning({
        title: $_('assistant.review.partial', {
          values: { saved: savedNow, failed: missing.length }
        }),
        description
      });
    } else {
      toaster.error({ title: $_('assistant.review.error'), description });
    }
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
            {n} × {statusLabel(status as EventRowStatus)}
          </span>
        {/if}
      {/each}
    </div>
  </div>

  {#if loadFailed}
    <div
      class="flex flex-wrap items-start gap-2 p-3 rounded-lg preset-tonal-error text-sm"
      role="alert"
    >
      <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
      <span class="flex-1 min-w-48">{$_('assistant.events.compareFailed')}</span>
      <button
        type="button"
        class="btn btn-sm preset-tonal-surface"
        onclick={retryLoad}
        disabled={loading || busy}
      >
        <Fa icon={faRotateRight} />
        <span>{$_('assistant.events.compareRetry')}</span>
      </button>
    </div>
  {:else if loading || !covered}
    <p class="flex items-center gap-2 text-sm text-surface-600-400" aria-live="polite">
      <Fa icon={faSpinner} spin />
      <span>{$_('assistant.events.comparing')}</span>
    </p>
  {/if}

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
        {@const failed = openFailures.includes(i)}
        <li
          class="card border p-3 space-y-2 {row.blocking || failed
            ? 'border-error-500'
            : 'border-surface-200-800'}"
          class:opacity-70={!row.selected}
        >
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-xs text-surface-600-400 tabular-nums">{i + 1}.</span>
            <span class="badge text-xs {STATUS_CLASS[row.status]}">
              {#if row.status === 'saved'}<Fa icon={faCheck} />{/if}
              <span>{statusLabel(row.status)}</span>
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
            {#if !input.saved}
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
            {/if}
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
                  class:border-error-500={has(row, 'badTimeTo')}
                  class:border-warning-500={warns(row, 'timeOrder')}
                  aria-invalid={has(row, 'badTimeTo')}
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
          {#if failed}
            <p class="flex items-start gap-1.5 text-xs text-error-600-400">
              <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
              <span>{$_('assistant.events.saveFailed')}</span>
            </p>
          {:else if recorded.includes(i) && !input.include}
            <p class="flex items-start gap-1.5 text-xs text-surface-600-400">
              <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
              <span>{$_('assistant.events.recordedAnyway')}</span>
            </p>
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
      {:else if openFailures.length > 0}
        {$_('assistant.events.retry', { values: { count: openFailures.length } })}
      {:else if count === 0}
        {$_('assistant.review.nothing')}
      {/if}
    </p>
    <button type="button" class="btn preset-tonal-surface" onclick={onback} disabled={busy}>
      {$_('assistant.review.back')}
    </button>
    <button type="button" class="btn preset-tonal-surface" onclick={oncancel} disabled={busy}>
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
