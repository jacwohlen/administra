<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faMagnifyingGlass,
    faRightLeft,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { formatTime } from '$lib/trainingUtils';
  import type { TrainerRole, TrainingPlanBreak, TrainingPlanSession } from '$lib/models';
  import {
    cancelledDates,
    checkInKey,
    createDraft,
    fetchAllRows,
    filterMembers,
    isHardIssue,
    labelList,
    memberHint,
    reviewDraft,
    skipOpen,
    sortMembers,
    weekdayOf,
    withDate,
    writtenWeekdays,
    type AttendanceDraft,
    type AttendanceMember,
    type CellState,
    type EntryDraft,
    type EntryReview
  } from '$lib/assistant/attendance';
  import { isIsoDate, MAX_LENGTH, clubToday } from '$lib/assistant/proposals';
  import type { AttendanceProposal } from '$lib/assistant/types';

  /**
   * Review of an attendance list read by the Daten-Assistent: every name is
   * matched to a member (or created, or left out), every date checked
   * against the training, and only what the user confirms is written, the
   * way the check-in page does it. Logic in $lib/assistant/attendance.
   */
  let {
    proposal,
    training,
    date,
    roster,
    onback,
    onclose,
    onapplied
  }: {
    proposal: AttendanceProposal;
    /** The check-in page's training, from its own data */
    training: { id: number; title: string; weekday: string | null; dateFrom: string | null };
    /** Date of the check-in page */
    date: string;
    /** Member ids on the training's roster */
    roster: number[];
    onback: () => void;
    onclose: () => void;
    /** Refreshes the page and closes the dialog */
    onapplied: () => Promise<void> | void;
  } = $props();

  type MemberRow = { id: number; firstname: string; lastname: string; labels: unknown };
  type LogRow = { date: string; memberId: number | null; trainerRole: TrainerRole };
  type SessionRow = Pick<TrainingPlanSession, 'date' | 'cancelled'>;

  const ROLES: TrainerRole[] = ['attendee', 'main_trainer', 'assistant'];
  const ROLE_KEYS: Record<TrainerRole, string> = {
    attendee: 'attendee',
    main_trainer: 'mainTrainer',
    assistant: 'assistant'
  };
  /** From this many members on, each row gets a search field */
  const LONG_LIST = 30;

  const STATUS_CLASS: Record<EntryReview['status'], string> = {
    new: 'preset-tonal-success',
    exists: 'preset-tonal-surface',
    changed: 'preset-tonal-warning',
    invalid: 'preset-tonal-error',
    duplicate: 'preset-tonal-tertiary',
    skipped: 'preset-tonal-surface',
    empty: 'preset-tonal-surface'
  };
  const CELL_CLASS: Record<CellState, string> = {
    off: 'bg-surface-100-900',
    excluded: 'bg-surface-100-900 line-through opacity-60',
    pending: 'preset-tonal-surface',
    new: 'preset-tonal-success',
    exists: 'preset-tonal-surface',
    changed: 'preset-tonal-warning'
  };

  const today = clubToday();
  const rosterIds = $derived(new Set(roster));

  let members = $state.raw<AttendanceMember[]>([]);
  let draft = $state<AttendanceDraft | null>(null);
  let existing = $state.raw(new Map<string, TrainerRole>());
  /** Dates whose recorded check-ins are loaded */
  let loaded = $state.raw(new Set<string>());
  let planned = $state(false);
  let sessions = $state.raw<SessionRow[]>([]);
  let breaks = $state.raw<TrainingPlanBreak[]>([]);
  let loadFailed = $state(false);
  let filters = $state<Record<number, string>>({});
  let searching = $state<Record<number, boolean>>({});
  let applying = $state(false);
  /** Set once an apply ran: the review is stale then and never saves twice */
  let applied = $state(false);
  let progress = $state({ done: 0, total: 0 });
  /** Prefix for the ids that tie a row's controls to the name as written */
  const uid = $props.id();

  const memberMap = $derived(new Map(members.map((m) => [m.id, m])));
  const sortedMembers = $derived(sortMembers(members));

  const review = $derived(
    draft
      ? reviewDraft(draft, {
          members: memberMap,
          roster: rosterIds,
          existing,
          cancelled: cancelledDates(
            draft.dates.map((d) => d.date),
            { planned, sessions, breaks }
          ),
          today,
          weekday: training.weekday
        })
      : null
  );
  const planDates = $derived(
    new Set(review ? review.plan.flatMap((p) => p.checkIns.map((c) => c.date)) : [])
  );
  /** Recorded check-ins of a date on the draft are still being loaded */
  const loadingExisting = $derived(
    !!draft && !loadFailed && draft.dates.some((d) => isIsoDate(d.date) && !loaded.has(d.date))
  );
  const canApply = $derived(
    !!review &&
      !applying &&
      !applied &&
      !loadFailed &&
      review.open === 0 &&
      review.checkIns > 0 &&
      // Only with the recorded check-ins of every date known, so none is overwritten unseen
      [...planDates].every((d) => loaded.has(d))
  );

  const trainingLabel = $derived(
    [
      training.title,
      training.weekday ? $_(`weekday.${training.weekday}`) : '',
      formatTime(training.dateFrom)
    ]
      .filter(Boolean)
      .join(' · ')
  );
  /** The list names another weekday than the training's */
  const otherWeekday = $derived.by(() => {
    const written = writtenWeekdays(proposal.trainingAsWritten);
    return training.weekday && written.length > 0 && !written.includes(training.weekday)
      ? written[0]
      : null;
  });

  async function init() {
    try {
      const [memberRows, plannedRow] = await Promise.all([
        fetchAllRows((from, to) =>
          supabaseClient
            .from('members')
            .select('id, firstname, lastname, labels')
            .is('archivedAt', null)
            .order('id')
            .range(from, to)
            .returns<MemberRow[]>()
        ),
        supabaseClient
          .from('training_plan_trainings')
          .select('training_id')
          .eq('training_id', training.id)
          .maybeSingle()
      ]);
      members = memberRows.map((m) => ({
        id: m.id,
        firstname: m.firstname ?? '',
        lastname: m.lastname ?? '',
        labels: labelList(m.labels)
      }));
      // The plan only adds a warning; without it the review still works
      if (plannedRow.error) console.error('Error loading the training plan:', plannedRow.error);
      planned = plannedRow.data != null;
      if (planned) {
        breaks = await fetchAllRows((from, to) =>
          supabaseClient
            .from('training_plan_breaks')
            .select('id, title, date_from, date_to, cancels_training')
            .order('id')
            .range(from, to)
            .returns<TrainingPlanBreak[]>()
        ).catch((err) => {
          console.error('Error loading the training plan breaks:', err);
          return [];
        });
      }
      draft = createDraft(proposal, {
        members,
        roster: rosterIds,
        pageDate: date,
        today,
        weekday: training.weekday
      });
    } catch (err) {
      console.error('Error loading members for the attendance review:', err);
      loadFailed = true;
    }
  }
  init();

  // Dates asked for once; a failed load blocks saving instead of retrying
  const requested = new Set<string>();

  async function loadDates(dates: string[]) {
    for (const d of dates) requested.add(d);
    try {
      const [logs, plan] = await Promise.all([
        fetchAllRows((from, to) =>
          supabaseClient
            .from('logs')
            .select('date, memberId, trainerRole')
            .eq('trainingId', training.id)
            .in('date', dates)
            .order('date')
            .order('memberId')
            .range(from, to)
            .returns<LogRow[]>()
        ),
        supabaseClient
          .from('training_plan_sessions')
          .select('date, cancelled')
          .eq('training_id', training.id)
          .in('date', dates)
          .returns<SessionRow[]>()
      ]);
      const next = new Map(existing);
      for (const l of logs) {
        if (l.memberId != null) next.set(checkInKey(l.date, l.memberId), l.trainerRole);
      }
      existing = next;
      if (plan.error) console.error('Error loading the training plan:', plan.error);
      else sessions = [...sessions, ...(plan.data ?? [])];
      loaded = new Set([...loaded, ...dates]);
    } catch (err) {
      console.error('Error loading recorded attendance:', err);
      loadFailed = true;
    }
  }

  // Recorded check-ins of every date on the draft, also of dates the user corrects
  $effect(() => {
    if (!draft) return;
    const missing = [...new Set(draft.dates.map((d) => d.date))].filter(
      (d) => isIsoDate(d) && !requested.has(d)
    );
    if (missing.length > 0) loadDates(missing);
  });

  function setDate(index: number, value: string) {
    if (draft) draft.dates[index] = withDate(value, today, training.weekday);
  }

  function choiceValue(entry: EntryDraft): string {
    if (entry.action === 'member') return entry.memberId === null ? '' : `m:${entry.memberId}`;
    return entry.action === 'open' ? '' : entry.action;
  }

  function choose(entry: EntryDraft, value: string) {
    // Any choice of the user's own counts as confirmed
    entry.unconfirmed = false;
    const id = value.startsWith('m:') ? Number(value.slice(2)) : NaN;
    if (memberMap.has(id)) {
      entry.action = 'member';
      entry.memberId = id;
    } else {
      entry.action = value === 'create' || value === 'skip' ? value : 'open';
    }
  }

  function swapNames(entry: EntryDraft) {
    [entry.lastname, entry.firstname] = [entry.firstname, entry.lastname];
  }

  /** Members offered in a row's select: filtered, but always with the chosen one */
  function options(index: number, entry: EntryDraft): AttendanceMember[] {
    const query = filters[index] ?? '';
    if (!query.trim()) return sortedMembers;
    const hits = filterMembers(sortedMembers, query);
    const chosen = entry.memberId === null ? undefined : memberMap.get(entry.memberId);
    return chosen && !hits.includes(chosen) ? [chosen, ...hits] : hits;
  }

  function showSearch(index: number, entry: EntryDraft): boolean {
    return (
      members.length > LONG_LIST &&
      (entry.action === 'open' || entry.unconfirmed || searching[index] === true)
    );
  }

  function memberName(m: AttendanceMember): string {
    return `${m.lastname} ${m.firstname}`.trim();
  }

  function short(value: string): string {
    return isIsoDate(value) ? dayjs(value).format('DD.MM.') : value;
  }

  function long(value: string): string {
    return isIsoDate(value) ? dayjs(value).format('DD.MM.YYYY') : value;
  }

  function roleLabel(role: TrainerRole): string {
    return $_(`assistant.attendance.roles.${ROLE_KEYS[role]}`);
  }

  function statusLabel(info: EntryReview): string {
    if (info.problem === 'confirm') return $_('assistant.attendance.status.confirm');
    if (info.status === 'skipped') return $_('assistant.review.skip');
    if (info.status === 'empty') return $_('assistant.attendance.status.empty');
    return $_(`assistant.review.status.${info.status}`);
  }

  function cellTitle(state: CellState, value: string): string {
    if (state === 'excluded') return $_('assistant.attendance.dates.excluded');
    if (state === 'new' || state === 'exists' || state === 'changed') {
      return `${long(value)}: ${$_(`assistant.review.status.${state}`)}`;
    }
    return long(value);
  }

  function similarNames(entry: EntryDraft): string {
    return entry.candidates
      .slice(0, 3)
      .map((id) => memberMap.get(id))
      .filter((m): m is AttendanceMember => !!m)
      .map((m) => `${m.firstname} ${m.lastname}`)
      .join(', ');
  }

  async function apply() {
    if (!review || !canApply) return;
    const { plan, checkIns } = review;
    applying = true;
    applied = true;
    progress = { done: 0, total: review.creates + review.rosterAdds + checkIns };
    const step = () => (progress.done += 1);
    let saved = 0;
    // Member id per planned person; missing when creating or rostering them failed
    const ids = new Map<number, number>();

    try {
      // New members first, exactly as the check-in page creates them
      for (const [i, p] of plan.entries()) {
        if (p.memberId !== null) {
          ids.set(i, p.memberId);
          continue;
        }
        if (!p.create) continue;
        const { data, error } = await supabaseClient
          .from('members')
          .insert({ lastname: p.create.lastname, firstname: p.create.firstname, labels: ['new'] })
          .select('id')
          .single<{ id: number }>();
        step();
        if (error || typeof data?.id !== 'number') {
          console.error('Error creating a member from the attendance list:', error);
          continue;
        }
        ids.set(i, data.id);
      }

      // On the roster, so the check-ins show on the check-in page
      for (const [i, p] of plan.entries()) {
        if (!p.addToRoster) continue;
        const memberId = ids.get(i);
        if (memberId !== undefined) {
          const { error } = await supabaseClient
            .from('participants')
            .upsert({ trainingId: training.id, memberId });
          if (error) {
            console.error('Error adding a participant from the attendance list:', error);
            ids.delete(i);
          }
        }
        step();
      }

      // One after the other: each check-in recalculates badges
      for (const [i, p] of plan.entries()) {
        const memberId = ids.get(i);
        for (const c of p.checkIns) {
          if (memberId !== undefined) {
            const { error } = await supabaseClient.rpc('set_attendance', {
              p_date: c.date,
              p_training_id: training.id,
              p_member_id: memberId,
              p_present: true,
              p_trainer_role: c.role
            });
            if (error) console.error('Error saving attendance from the attendance list:', error);
            else saved++;
          }
          step();
        }
      }
    } catch (err) {
      console.error('Error applying the attendance list:', err);
    }

    const failed = checkIns - saved;
    if (failed === 0) {
      toaster.success({ title: $_('assistant.review.done', { values: { count: saved } }) });
    } else if (saved > 0) {
      toaster.warning({ title: $_('assistant.review.partial', { values: { saved, failed } }) });
    } else {
      toaster.error({ title: $_('assistant.review.error') });
    }
    try {
      await onapplied();
    } catch (err) {
      console.error('Error refreshing after the attendance list:', err);
    } finally {
      applying = false;
    }
  }
</script>

<!-- Saving stays blocked after a failed load; the review is kept visible -->
{#if loadFailed}
  <div class="flex items-start gap-2 p-3 rounded-lg preset-tonal-error text-sm" role="alert">
    <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
    <span>{$_('assistant.attendance.loadError')}</span>
  </div>
{/if}
{#if !draft || !review}
  {#if !loadFailed}
    <div class="flex items-center gap-2 py-6 text-sm text-surface-600-400" aria-live="polite">
      <Fa icon={faSpinner} spin />
      <span>{$_('assistant.attendance.loading')}</span>
    </div>
  {/if}
{:else if draft.entries.length === 0}
  <div class="empty-state"><p>{$_('assistant.attendance.noEntries')}</p></div>
{:else}
  <div class="space-y-1 text-sm">
    <p>{$_('assistant.attendance.training', { values: { training: trainingLabel } })}</p>
    {#if proposal.trainingAsWritten}
      <p class="text-surface-600-400">
        {$_('assistant.attendance.listTraining', { values: { text: proposal.trainingAsWritten } })}
      </p>
    {/if}
    {#if otherWeekday && training.weekday}
      <div class="flex items-start gap-2 p-3 rounded-lg preset-tonal-warning">
        <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
        <span>
          {$_('assistant.attendance.otherWeekday', {
            values: {
              written: $_(`weekday.${otherWeekday}`),
              weekday: $_(`weekday.${training.weekday}`)
            }
          })}
        </span>
      </div>
    {/if}
  </div>

  <!-- Dates -->
  <section class="space-y-2">
    <h4 class="font-semibold">
      {draft.grid
        ? $_('assistant.attendance.dates.titleGrid')
        : $_('assistant.attendance.dates.titleSingle')}
    </h4>
    <ul class="space-y-2">
      {#each draft.dates as d, j (j)}
        {@const info = review.dates[j]}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {#if isHardIssue(info.issue)}
            {#if draft.grid}
              <input
                class="checkbox"
                type="checkbox"
                checked={false}
                disabled
                aria-label={$_('assistant.attendance.dates.include', {
                  values: { date: long(d.date) }
                })}
              />
            {/if}
          {:else if draft.grid || info.issue === 'weekday'}
            <input
              class="checkbox"
              type="checkbox"
              bind:checked={d.include}
              disabled={applying}
              aria-label={$_('assistant.attendance.dates.include', {
                values: { date: long(d.date) }
              })}
            />
          {/if}
          <input
            class="input w-auto"
            type="date"
            max={today}
            value={d.date}
            disabled={applying}
            aria-label={$_('assistant.attendance.dates.date')}
            onchange={(e) => setDate(j, e.currentTarget.value)}
          />
          {#if isIsoDate(d.date)}
            <span>{$_(`weekday.${weekdayOf(d.date)}`)}</span>
          {/if}
          {#if draft.grid}
            <span class="text-surface-600-400">
              {$_('assistant.attendance.dates.marked', { values: { count: info.marked } })}
            </span>
          {/if}
          {#if info.issue}
            <span class={isHardIssue(info.issue) ? 'text-error-600-400' : 'text-warning-700-300'}>
              {$_(`assistant.attendance.dates.issues.${info.issue}`, {
                values: {
                  weekday: isIsoDate(d.date) ? $_(`weekday.${weekdayOf(d.date)}`) : '',
                  training: training.weekday ? $_(`weekday.${training.weekday}`) : ''
                }
              })}
            </span>
          {/if}
          {#if info.cancelled}
            <span class="text-warning-700-300">{$_('assistant.attendance.dates.cancelled')}</span>
          {/if}
          {#if !draft.grid && d.date !== date && isIsoDate(date)}
            <span class="text-surface-600-400">
              {$_('assistant.attendance.dates.notPageDate', { values: { date: long(date) } })}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !draft.grid && draft.listDates.length > 0 && !draft.listDates.includes(draft.dates[0].date)}
      <p class="text-xs text-surface-600-400">
        {$_('assistant.attendance.dates.listDate', {
          values: { dates: draft.listDates.map(long).join(', ') }
        })}
      </p>
    {/if}
  </section>

  <!-- People -->
  <section class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="font-semibold">
        {$_('assistant.attendance.people.title', { values: { count: draft.entries.length } })}
      </h4>
      {#if draft.entries.some((e) => e.action === 'open')}
        <button
          type="button"
          class="btn btn-sm preset-tonal-surface"
          disabled={applying}
          onclick={() => draft && skipOpen(draft.entries)}
        >
          {$_('assistant.attendance.people.skipOpen')}
        </button>
      {/if}
    </div>

    <ul class="space-y-2">
      {#each draft.entries as entry, i (i)}
        {@const info = review.entries[i]}
        {@const hint = info.member ? memberHint(info.member) : null}
        <li
          class="card border p-3 space-y-2 {info.problem
            ? 'border-warning-500'
            : 'border-surface-200-800'}"
        >
          <div class="flex flex-wrap items-start gap-2">
            <div class="min-w-0 flex-1 {entry.action === 'skip' ? 'opacity-60' : ''}">
              <p id="{uid}-name-{i}" class="font-semibold break-words">{entry.name}</p>
              {#if entry.confidence === 'low'}
                <span class="badge preset-tonal-warning text-xs">
                  {$_('assistant.review.uncertain')}
                </span>
              {/if}
              {#if entry.remark}
                <p class="text-xs italic text-surface-600-400 break-words">{entry.remark}</p>
              {/if}
            </div>
            <span class="badge text-xs {STATUS_CLASS[info.status]}">{statusLabel(info)}</span>
          </div>

          <div class="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <div class="flex flex-wrap items-center gap-2 min-w-0">
              {#if showSearch(i, entry)}
                <input
                  class="input flex-1 min-w-[10rem]"
                  type="search"
                  placeholder={$_('assistant.attendance.people.filter')}
                  aria-label={$_('assistant.attendance.people.filter')}
                  aria-describedby="{uid}-name-{i}"
                  disabled={applying}
                  bind:value={filters[i]}
                />
              {/if}
              <select
                class="select flex-1 min-w-[12rem]"
                value={choiceValue(entry)}
                disabled={applying}
                aria-label={$_('assistant.attendance.people.member')}
                aria-describedby="{uid}-name-{i}"
                onchange={(e) => choose(entry, e.currentTarget.value)}
              >
                <option value="">{$_('assistant.review.pickMember')}</option>
                {#if entry.candidates.length > 0}
                  <optgroup label={$_('assistant.attendance.people.suggestions')}>
                    {#each entry.candidates as id (id)}
                      {@const m = memberMap.get(id)}
                      {#if m}
                        <option value="m:{m.id}">{memberName(m)}</option>
                      {/if}
                    {/each}
                  </optgroup>
                {/if}
                <optgroup label={$_('assistant.attendance.people.allMembers')}>
                  {#each options(i, entry) as m (m.id)}
                    <option value="m:{m.id}">{memberName(m)}</option>
                  {/each}
                </optgroup>
                <option value="create">{$_('assistant.attendance.people.createNew')}</option>
                <option value="skip">{$_('assistant.review.skip')}</option>
              </select>
              {#if entry.action === 'member' && entry.unconfirmed}
                <button
                  type="button"
                  class="btn btn-sm preset-filled-warning-500"
                  disabled={applying}
                  aria-describedby="{uid}-name-{i}"
                  onclick={() => (entry.unconfirmed = false)}
                >
                  <Fa icon={faCheck} />
                  <span>{$_('assistant.attendance.people.confirm')}</span>
                </button>
              {:else if members.length > LONG_LIST && !showSearch(i, entry)}
                <button
                  type="button"
                  class="btn-icon btn-icon-sm preset-tonal-surface"
                  title={$_('assistant.attendance.people.search')}
                  aria-label={$_('assistant.attendance.people.search')}
                  disabled={applying}
                  onclick={() => (searching[i] = true)}
                >
                  <Fa icon={faMagnifyingGlass} />
                </button>
              {/if}
            </div>
            <select
              class="select"
              bind:value={entry.role}
              disabled={applying || entry.action === 'skip'}
              aria-label={$_('assistant.attendance.people.role')}
              aria-describedby="{uid}-name-{i}"
            >
              {#each ROLES as role (role)}
                <option value={role}>{roleLabel(role)}</option>
              {/each}
            </select>
          </div>

          {#if entry.action === 'create'}
            <div class="space-y-2 rounded-lg bg-surface-100-900 p-2">
              <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                <label class="label">
                  <span class="text-xs">{$_('dialog.newMember.lastName')}</span>
                  <input
                    class="input"
                    type="text"
                    maxlength={MAX_LENGTH.name}
                    disabled={applying}
                    bind:value={entry.lastname}
                  />
                </label>
                <button
                  type="button"
                  class="btn-icon preset-tonal-surface justify-self-center"
                  title={$_('assistant.attendance.people.swapNames')}
                  aria-label={$_('assistant.attendance.people.swapNames')}
                  disabled={applying}
                  onclick={() => swapNames(entry)}
                >
                  <Fa icon={faRightLeft} />
                </button>
                <label class="label">
                  <span class="text-xs">{$_('dialog.newMember.firstName')}</span>
                  <input
                    class="input"
                    type="text"
                    maxlength={MAX_LENGTH.name}
                    disabled={applying}
                    bind:value={entry.firstname}
                  />
                </label>
              </div>
              <p class="flex items-start gap-2 text-xs text-warning-700-300">
                <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
                <span>{$_('assistant.attendance.people.createWarning')}</span>
              </p>
              {#if similarNames(entry)}
                <p class="text-xs">
                  {$_('assistant.attendance.people.similar', {
                    values: { names: similarNames(entry) }
                  })}
                </p>
              {/if}
            </div>
          {/if}

          {#if draft.grid && entry.action !== 'skip'}
            <div class="flex flex-wrap gap-1">
              {#each draft.dates as d, j (j)}
                <label
                  class="chip text-xs gap-1 cursor-pointer {CELL_CLASS[info.cells[j]]}"
                  title={cellTitle(info.cells[j], d.date)}
                >
                  <input
                    class="checkbox"
                    type="checkbox"
                    disabled={applying}
                    aria-label={$_('assistant.attendance.people.present', {
                      values: { date: long(d.date) }
                    })}
                    aria-describedby="{uid}-name-{i}"
                    bind:checked={entry.marks[j]}
                  />
                  <span>{short(d.date)}</span>
                </label>
              {/each}
            </div>
          {/if}

          {#if info.problem}
            <p class="text-xs text-warning-700-300">
              {$_(`assistant.attendance.problems.${info.problem}`)}
            </p>
          {/if}
          {#if info.duplicateOf !== null}
            <p class="text-xs text-surface-600-400">
              {$_('assistant.attendance.people.duplicateOf', {
                values: { name: draft.entries[info.duplicateOf].name }
              })}
            </p>
          {/if}
          {#if info.addsToRoster && info.duplicateOf === null}
            <p class="text-xs text-surface-600-400">
              {$_('assistant.attendance.people.notOnRoster')}
            </p>
          {/if}
          {#if hint && entry.action === 'member'}
            <p class="text-xs text-warning-700-300">{$_(`assistant.attendance.hints.${hint}`)}</p>
          {/if}
          {#if info.existingRoles.length > 0}
            <label class="flex items-center gap-2 text-xs">
              <input
                class="checkbox"
                type="checkbox"
                disabled={applying}
                bind:checked={entry.overwrite}
              />
              <span>
                {$_('assistant.attendance.people.overwrite', {
                  values: { roles: info.existingRoles.map(roleLabel).join(', ') }
                })}
              </span>
            </label>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <div class="space-y-1 text-sm">
    {#if review.checkIns > 0}
      <p>
        {[
          $_('assistant.attendance.summary', {
            values: { checkIns: review.checkIns, dates: planDates.size }
          }),
          review.creates > 0
            ? $_('assistant.attendance.summaryCreates', { values: { count: review.creates } })
            : '',
          review.rosterAdds > 0
            ? $_('assistant.attendance.summaryRoster', { values: { count: review.rosterAdds } })
            : ''
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    {:else if review.open === 0}
      <p class="text-surface-600-400">{$_('assistant.review.nothing')}</p>
    {/if}
    {#if loadingExisting}
      <p class="flex items-center gap-2 text-surface-600-400" aria-live="polite">
        <Fa icon={faSpinner} spin />
        <span>{$_('assistant.attendance.loadingExisting')}</span>
      </p>
    {/if}
    {#if review.open > 0}
      <p class="text-warning-700-300">
        {$_('assistant.attendance.open', { values: { count: review.open } })}
      </p>
    {/if}
    <p class="text-xs text-surface-600-400">{$_('assistant.attendance.onlyPresent')}</p>
  </div>

  {#if applying}
    <div class="space-y-1" aria-live="polite">
      <div
        class="h-2 rounded-full bg-surface-200-800 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
      >
        <div
          class="h-full bg-primary-500 transition-all"
          style:width="{progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%"
        ></div>
      </div>
      <p class="text-xs text-surface-600-400">
        {$_('assistant.attendance.progress', {
          values: { done: progress.done, total: progress.total }
        })}
      </p>
    </div>
  {/if}
{/if}

<footer class="flex flex-wrap items-center justify-end gap-2 pt-2">
  <button
    type="button"
    class="btn preset-tonal-surface mr-auto"
    disabled={applying}
    onclick={onback}
  >
    {$_('assistant.review.back')}
  </button>
  <button type="button" class="btn preset-tonal-surface" disabled={applying} onclick={onclose}>
    {$_('button.cancel')}
  </button>
  <button type="button" class="btn preset-filled-primary-500" disabled={!canApply} onclick={apply}>
    {#if applying}
      <Fa icon={faSpinner} spin />
      <span>{$_('assistant.review.applying')}</span>
    {:else}
      <Fa icon={faCheck} />
      <span>{$_('assistant.review.apply', { values: { count: review?.checkIns ?? 0 } })}</span>
    {/if}
  </button>
</footer>
