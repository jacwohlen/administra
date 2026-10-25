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
    adoptMember,
    cancelledDates,
    checkInKey,
    chooseEntry,
    confirmRosterSuggestions,
    createDraft,
    createdAnyway,
    fetchAllRows,
    filterMembers,
    isHardIssue,
    isRosterSuggestionOpen,
    labelList,
    memberHint,
    nameTwins,
    openFailures,
    personRows,
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
    type EntryReview,
    type NewMember,
    type SaveFailure
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
    onapplied,
    onpartial
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
    /** Everything saved: refreshes the page and closes the dialog */
    onapplied: () => Promise<void> | void;
    /** Some of it saved, the review stays open for the rest: the page refreshes when it closes */
    onpartial: () => void;
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
  /** Put on the roster by a save that failed in part (the page's roster is reloaded on close) */
  let addedToRoster = $state.raw(new Set<number>());
  const rosterIds = $derived(new Set([...roster, ...addedToRoster]));

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
  /** Set once everything is saved: the dialog closes then, and never saves twice */
  let applied = $state(false);
  /** A save wrote something: closing is no longer cancelling */
  let savedSome = $state(false);
  /** By the first row of a person: what the last save could not write */
  let failures = $state.raw(new Map<number, SaveFailure>());
  /** First rows of the people the last save wrote completely */
  let savedRows = $state.raw(new Set<number>());
  let progress = $state({ done: 0, total: 0 });
  /** Prefix for the ids that tie a row's controls to the name as written */
  const uid = $props.id();

  const memberMap = $derived(new Map(members.map((m) => [m.id, m])));
  const sortedMembers = $derived(sortMembers(members));
  /** Members sharing their name with another: told apart in the selects */
  const twins = $derived(nameTwins(members, rosterIds));

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
  /** Suggestions on the roster that may be confirmed at once */
  const rosterSuggestions = $derived(
    draft ? draft.entries.filter(isRosterSuggestionOpen).length : 0
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

  function toMember(m: MemberRow): AttendanceMember {
    return {
      id: m.id,
      firstname: m.firstname ?? '',
      lastname: m.lastname ?? '',
      labels: labelList(m.labels)
    };
  }

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
      members = memberRows.map(toMember);
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

  // Dates asked for once; a failed load blocks saving until «Neu laden»
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
      else sessions = [...sessions.filter((s) => !dates.includes(s.date)), ...(plan.data ?? [])];
      loaded = new Set([...loaded, ...dates]);
    } catch (err) {
      console.error('Error loading recorded attendance:', err);
      for (const d of dates) requested.delete(d);
      loadFailed = true;
    }
  }

  /** «Neu laden» after a failed load: the members, or the dates still missing */
  async function retryLoad() {
    loadFailed = false;
    if (!draft) {
      await init();
      return;
    }
    const missing = [...new Set(draft.dates.map((d) => d.date))].filter(
      (d) => isIsoDate(d) && !loaded.has(d)
    );
    if (missing.length > 0) await loadDates(missing);
  }

  /** An overwrite tick is consent for the check-ins shown when it was given, not for others */
  function resetOverwrites() {
    for (const entry of draft?.entries ?? []) entry.overwrite = false;
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
    if (!draft) return;
    draft.dates[index] = withDate(value, today, training.weekday);
    resetOverwrites();
  }

  function choiceValue(entry: EntryDraft): string {
    if (entry.action === 'member') return entry.memberId === null ? '' : `m:${entry.memberId}`;
    return entry.action === 'open' ? '' : entry.action;
  }

  /** A row's search is done once a member is chosen or confirmed: its filter must not linger */
  function endSearch(index: number) {
    filters[index] = '';
    searching[index] = false;
  }

  /** A row set to another person: what the last save said about it no longer applies */
  function forgetSave(index: number) {
    if (failures.has(index)) failures = new Map([...failures].filter(([row]) => row !== index));
    if (savedRows.has(index)) savedRows = new Set([...savedRows].filter((row) => row !== index));
  }

  function choose(index: number, entry: EntryDraft, value: string) {
    chooseEntry(entry, value, (id) => memberMap.has(id));
    endSearch(index);
    forgetSave(index);
  }

  function confirm(index: number, entry: EntryDraft) {
    entry.unconfirmed = false;
    endSearch(index);
  }

  function confirmSuggestions() {
    if (draft) for (const i of confirmRosterSuggestions(draft.entries)) endSearch(i);
  }

  function swapNames(entry: EntryDraft) {
    [entry.lastname, entry.firstname] = [entry.firstname, entry.lastname];
  }

  /** Members offered in a row's select: filtered while the search shows, always with the chosen one */
  function options(index: number, entry: EntryDraft): AttendanceMember[] {
    const query = showSearch(index, entry) ? (filters[index] ?? '') : '';
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

  /** A member in a select; with the roster, labels or id when another member has the same name */
  function optionLabel(m: AttendanceMember): string {
    const twin = twins.get(m.id);
    if (!twin) return memberName(m);
    const details = twin.details.map((d) => $_(`assistant.attendance.people.details.${d}`));
    if (twin.showId) {
      details.push($_('assistant.attendance.people.details.id', { values: { id: m.id } }));
    }
    return $_('assistant.attendance.people.option', {
      values: { name: memberName(m), details: details.join(', ') }
    });
  }

  function failureText(failure: SaveFailure): string {
    if (failure.step !== 'checkIn') return $_(`assistant.attendance.failed.${failure.step}`);
    return $_('assistant.attendance.failed.checkIn', {
      values: { dates: failure.checkIns.map((c) => long(c.date)).join(', ') }
    });
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

  /** One write; an error or an exception counts as failed */
  async function attempt(
    what: string,
    write: () => PromiseLike<{ error: unknown }>
  ): Promise<boolean> {
    try {
      const { error } = await write();
      if (!error) return true;
      console.error(`Error ${what} from the attendance list:`, error);
    } catch (err) {
      console.error(`Error ${what} from the attendance list:`, err);
    }
    return false;
  }

  /** A new member exactly as the check-in page creates them; null when that failed */
  async function createMember(create: NewMember): Promise<number | null> {
    try {
      const { data, error } = await supabaseClient
        .from('members')
        .insert({ lastname: create.lastname, firstname: create.firstname, labels: ['new'] })
        .select('id')
        .single<{ id: number }>();
      if (!error && typeof data?.id === 'number') return data.id;
      console.error('Error creating a member from the attendance list:', error);
    } catch (err) {
      console.error('Error creating a member from the attendance list:', err);
    }
    return null;
  }

  /**
   * After a save that failed in part: reloads the recorded check-ins of the
   * failed dates, so what committed despite an error shows as recorded, and
   * looks for members an insert created although it reported an error; their
   * rows then suggest that member instead of creating another one.
   */
  async function recheck(
    failed: Map<number, SaveFailure>,
    creates: { row: number; rows: number[]; create: NewMember }[]
  ) {
    const dates = [...new Set([...failed.values()].flatMap((f) => f.checkIns.map((c) => c.date)))];
    if (dates.length > 0) {
      // Saving waits for them again
      loaded = new Set([...loaded].filter((d) => !dates.includes(d)));
      await loadDates(dates);
    }
    for (const { row, rows, create } of creates) {
      try {
        const { data, error } = await supabaseClient
          .from('members')
          .select('id, firstname, lastname, labels')
          .eq('lastname', create.lastname)
          .eq('firstname', create.firstname)
          .is('archivedAt', null)
          .returns<MemberRow[]>();
        if (error) throw error;
        const found = createdAnyway(create, (data ?? []).map(toMember), memberMap);
        const failure = failed.get(row);
        if (!found || !draft || !failure) continue;
        members = [...members, found];
        adoptMember(draft.entries, rows, found.id, false);
        failed.set(row, { ...failure, step: 'createdAnyway', memberId: found.id });
      } catch (err) {
        console.error('Error checking a member created from the attendance list:', err);
      }
    }
    failures = openFailures(failed, existing);
  }

  async function apply() {
    if (!review || !draft || !canApply) return;
    const snapshot = review;
    const { plan, checkIns } = snapshot;
    applying = true;
    failures = new Map();
    savedRows = new Set();
    progress = { done: 0, total: snapshot.creates + snapshot.rosterAdds + checkIns };
    const failed = new Map<number, SaveFailure>();
    const done = new Set<number>();
    const created: { rows: number[]; member: AttendanceMember }[] = [];
    const failedCreates: { row: number; rows: number[]; create: NewMember }[] = [];
    const rostered: number[] = [];
    const written: [string, TrainerRole][] = [];

    // One person after the other: create them, put them on the roster, then
    // each check-in (each recalculates badges). A failed step skips the rest
    // of that person, so nobody is checked in off the roster.
    for (const p of plan) {
      const end = progress.done + (p.memberId === null ? 1 : 0) + (p.addToRoster ? 1 : 0);
      const fail = (step: SaveFailure['step'], memberId: number | null) => {
        failed.set(p.entry, { step, memberId, checkIns: p.checkIns });
        progress.done = end + p.checkIns.length;
      };
      let memberId = p.memberId;
      if (memberId === null) {
        memberId = p.create ? await createMember(p.create) : null;
        progress.done += 1;
        if (memberId === null) {
          if (p.create) {
            failedCreates.push({
              row: p.entry,
              rows: personRows(snapshot, p.entry),
              create: p.create
            });
          }
          fail('create', null);
          continue;
        }
        if (p.create) {
          created.push({
            rows: personRows(snapshot, p.entry),
            member: { id: memberId, ...p.create, labels: ['new'] }
          });
        }
      }
      const id = memberId;
      if (p.addToRoster) {
        const ok = await attempt('adding a participant', () =>
          supabaseClient.from('participants').upsert({ trainingId: training.id, memberId: id })
        );
        progress.done += 1;
        if (!ok) {
          fail('roster', id);
          continue;
        }
        rostered.push(id);
      }
      const missed: SaveFailure['checkIns'] = [];
      for (const c of p.checkIns) {
        const ok = await attempt('saving attendance', () =>
          supabaseClient.rpc('set_attendance', {
            p_date: c.date,
            p_training_id: training.id,
            p_member_id: id,
            p_present: true,
            p_trainer_role: c.role
          })
        );
        progress.done += 1;
        if (ok) {
          written.push([checkInKey(c.date, id), c.role]);
        } else {
          missed.push(c);
        }
      }
      if (missed.length > 0) {
        failed.set(p.entry, { step: 'checkIn', memberId: id, checkIns: missed });
      } else {
        done.add(p.entry);
      }
    }

    // What was written is part of the review now: the rows of a new member
    // point at them (a retry does not create them twice), saved check-ins
    // show as recorded and drop out of the next save
    if (created.length > 0) {
      members = [...members, ...created.map((c) => c.member)];
      for (const c of created) adoptMember(draft.entries, c.rows, c.member.id, true);
    }
    if (rostered.length > 0) addedToRoster = new Set([...addedToRoster, ...rostered]);
    if (written.length > 0) existing = new Map([...existing, ...written]);

    if (failed.size > 0) {
      // A write that reported an error may have gone through all the same:
      // the page refreshes when the dialog closes, and what the reload shows
      // as committed counts as saved
      onpartial();
      failures = failed;
      try {
        await recheck(failed, failedCreates);
      } catch (err) {
        console.error('Error reloading after the attendance list:', err);
      }
      for (const row of failed.keys()) if (!failures.has(row)) done.add(row);
    }
    const missed = [...failures.values()].reduce((sum, f) => sum + f.checkIns.length, 0);
    const saved = checkIns - missed;

    if (failures.size === 0) {
      applied = true;
      toaster.success({ title: $_('assistant.review.done', { values: { count: saved } }) });
      try {
        await onapplied();
      } catch (err) {
        console.error('Error refreshing after the attendance list:', err);
      } finally {
        applying = false;
      }
      return;
    }

    // Not everything: the review stays open with the failed rows to retry
    if (saved > 0) {
      toaster.warning({
        title: $_('assistant.review.partial', { values: { saved, failed: missed } })
      });
    } else {
      toaster.error({ title: $_('assistant.review.error') });
    }
    savedSome ||=
      saved > 0 ||
      created.length > 0 ||
      rostered.length > 0 ||
      [...failures.values()].some((f) => f.step === 'createdAnyway');
    savedRows = done;
    applying = false;
  }
</script>

<!-- Saving stays blocked after a failed load; the review is kept visible -->
{#if loadFailed}
  <div
    class="flex flex-wrap items-start gap-2 p-3 rounded-lg preset-tonal-error text-sm"
    role="alert"
  >
    <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
    <span class="flex-1">{$_('assistant.attendance.loadError')}</span>
    <button type="button" class="btn btn-sm preset-tonal-surface" onclick={retryLoad}>
      {$_('assistant.attendance.reload')}
    </button>
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
              onchange={resetOverwrites}
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
            <span class="flex items-center gap-1 text-warning-700-300">
              <Fa icon={faTriangleExclamation} class="flex-none" />
              <span>
                {$_('assistant.attendance.dates.notPageDate', { values: { date: long(date) } })}
              </span>
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
      <div class="flex flex-wrap gap-2">
        {#if rosterSuggestions > 0}
          <button
            type="button"
            class="btn btn-sm preset-tonal-warning"
            disabled={applying}
            onclick={confirmSuggestions}
          >
            <Fa icon={faCheck} />
            <span>
              {$_('assistant.attendance.people.confirmRoster', {
                values: { count: rosterSuggestions }
              })}
            </span>
          </button>
        {/if}
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
    </div>

    <ul class="space-y-2">
      {#each draft.entries as entry, i (i)}
        {@const info = review.entries[i]}
        {@const hint = info.member ? memberHint(info.member) : null}
        {@const failure = failures.get(i)}
        <li
          class="card border p-3 space-y-2 {failure
            ? 'border-error-500'
            : info.problem
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
                onchange={(e) => choose(i, entry, e.currentTarget.value)}
              >
                <option value="">{$_('assistant.review.pickMember')}</option>
                {#if entry.candidates.length > 0}
                  <optgroup label={$_('assistant.attendance.people.suggestions')}>
                    {#each entry.candidates as id (id)}
                      {@const m = memberMap.get(id)}
                      {#if m}
                        <option value="m:{m.id}">{optionLabel(m)}</option>
                      {/if}
                    {/each}
                  </optgroup>
                {/if}
                <optgroup label={$_('assistant.attendance.people.allMembers')}>
                  {#each options(i, entry) as m (m.id)}
                    <option value="m:{m.id}">{optionLabel(m)}</option>
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
                  onclick={() => confirm(i, entry)}
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
                    onchange={() => (entry.overwrite = false)}
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
            {#if info.problem === 'confirm'}
              <p class="text-xs text-warning-700-300">
                {$_('assistant.attendance.people.notOnRosterConfirm')}
              </p>
            {:else}
              <p class="text-xs text-surface-600-400">
                {$_('assistant.attendance.people.notOnRoster')}
              </p>
            {/if}
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
          {#if failure}
            <p class="flex items-start gap-2 text-xs text-error-600-400">
              <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
              <span>{failureText(failure)}</span>
            </p>
          {:else if savedRows.has(i) && info.status === 'exists'}
            <p class="flex items-center gap-2 text-xs text-success-700-300">
              <Fa icon={faCheck} class="flex-none" />
              <span>{$_('assistant.attendance.people.saved')}</span>
            </p>
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
    {#if failures.size > 0 && !applying}
      <p class="flex items-start gap-2 text-error-600-400" role="alert">
        <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
        <span>
          {$_('assistant.attendance.partialHint', { values: { count: failures.size } })}
        </span>
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
    {savedSome ? $_('button.close') : $_('button.cancel')}
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
