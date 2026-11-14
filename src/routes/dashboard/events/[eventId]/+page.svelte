<script lang="ts">
  import MoreMenu from '#lib/components/MoreMenu.svelte';
  import type { PageData } from './$types';
  import { supabaseClient } from '#lib/supabase.ts';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { toaster } from '#lib/toast.ts';
  import {
    faCalendarDays,
    faLocationDot,
    faClock,
    faUsers,
    faUserCheck,
    faArrowLeft,
    faEdit,
    faTrash,
    faChalkboardTeacher,
    faArrowsRotate,
    faArrowUpRightFromSquare,
    faUser,
    faUserMinus
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { goto } from '$app/navigation';
  import { flip } from 'svelte/animate';
  import { quintInOut } from 'svelte/easing';
  import { SvelteSet } from 'svelte/reactivity';
  import AddMemberInputBox from '#lib/components/AddMemberInputBox.svelte';
  import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
  import {
    canTrackAttendance as _canTrackAttendance,
    isRegistrationOpen as _isRegistrationOpen,
    canAddParticipants,
    attendanceTimestamp,
    calculateAttendanceRate,
    compareCheckinPeople,
    formatEventDates,
    matchesCheckinSearch
  } from '#lib/eventUtils.ts';
  import type {
    CoachDay,
    EventLog,
    EventParticipantRow,
    Medal,
    Member,
    MemberMedal
  } from '#lib/models.ts';
  import { MEDALS, medalEmoji } from '#lib/gradeUtils.ts';
  import { canDeleteEvent } from '#lib/eventLinks.ts';
  import { isManagedByProviderError, providerName } from '#lib/memberStatus.ts';

  let { data }: { data: PageData } = $props();

  let isDeleting = $state(false);
  let showDeleteConfirm = $state(false);
  let confirmRemoveId = $state<string | null>(null);

  // An event its provider still has is maintained there: no delete, and the
  // edit page locks what the provider owns (the registration deadline stays ours)
  let provider = $derived(data.eventLink ? providerName(data.eventLink.connection) : null);
  let canDelete = $derived(canDeleteEvent(data.canWrite, data.eventLink));

  // The check-in list changes right away, like on the training check-in; the
  // database follows in the background, and a failed write is undone. Only
  // the row being saved waits, the rest of the list stays usable.
  let participants = $derived(data.participants);
  let logs = $derived(data.logs);
  let medals = $derived(data.medals);
  const busy = new SvelteSet<string>();

  let search = $state('');
  let animateList = $state(true);

  const sameMember = (a: string | number, b: string | number) => String(a) === String(b);

  function formatEventDate(date: string) {
    return dayjs(date).format('DD.MM.YYYY');
  }

  function formatTime(time: string | undefined) {
    return time || '';
  }

  function attendedAt() {
    return attendanceTimestamp(data.event.date, data.event.timeFrom, data.event.date_to);
  }

  function isRegistrationOpen() {
    return _isRegistrationOpen(data.event.registrationDeadline);
  }

  function memberName(memberId: string) {
    const member = participants.find((p) => sameMember(p.memberId, memberId))?.members;
    return member ? `${member.lastname} ${member.firstname}` : '';
  }

  // From the first day on (every day of a multi-day event)
  let tracking = $derived(_canTrackAttendance(data.event.date));

  interface Row {
    participant: EventParticipantRow;
    member: NonNullable<EventParticipantRow['members']>;
    log: EventLog | undefined;
    placement: MemberMedal | undefined;
    lastname: string;
    firstname: string;
    attended: boolean;
  }

  let rows: Row[] = $derived(
    participants
      .filter((p) => p.members)
      .map((p) => {
        const log = logs.find((l) => sameMember(l.memberId, p.memberId));
        return {
          participant: p,
          member: p.members!,
          log,
          placement: medals.find((m) => sameMember(m.memberId, p.memberId)),
          lastname: p.members!.lastname,
          firstname: p.members!.firstname,
          attended: !!log
        };
      })
      .sort(compareCheckinPeople)
  );
  let shownRows = $derived(rows.filter((r) => matchesCheckinSearch(r, search)));

  async function withBusy(memberId: string, work: () => Promise<void>) {
    const key = String(memberId);
    if (busy.has(key)) return;
    busy.add(key);
    try {
      await work();
    } finally {
      busy.delete(key);
    }
  }

  function setParticipantStatus(memberId: string, attendanceStatus: 'attended' | 'registered') {
    participants = participants.map((p) =>
      sameMember(p.memberId, memberId) ? { ...p, attendanceStatus } : p
    );
  }

  /** Check a participant in or out: the attendance row, and the registration's status */
  function setAttendance(memberId: string, attended: boolean) {
    return withBusy(memberId, async () => {
      const before = { logs, participants };
      try {
        if (attended) {
          const pending: EventLog = {
            id: -1,
            eventId: data.event.id,
            memberId,
            attendedAt: attendedAt(),
            isCoach: false,
            coachDay: 'full'
          };
          logs = [...logs, pending];
          const { data: saved, error } = await supabaseClient
            .from('event_logs')
            .insert({ eventId: data.event.id, memberId, attendedAt: pending.attendedAt })
            .select()
            .single();
          if (error) throw error;
          logs = logs.map((l) => (l === pending ? (saved as EventLog) : l));
        } else {
          logs = logs.filter((l) => !sameMember(l.memberId, memberId));
          const { error } = await supabaseClient
            .from('event_logs')
            .delete()
            .eq('eventId', data.event.id)
            .eq('memberId', memberId);
          if (error) throw error;
        }
        const status = attended ? 'attended' : 'registered';
        setParticipantStatus(memberId, status);
        // The attendance row is what counts; the status only labels the registration
        const { error: statusError } = await supabaseClient
          .from('event_participants')
          .update({ attendanceStatus: status })
          .eq('eventId', data.event.id)
          .eq('memberId', memberId);
        if (statusError) console.error('Error saving the registration status:', statusError);
      } catch (error) {
        console.error('Error saving attendance:', error);
        logs = before.logs;
        participants = before.participants;
        toaster.error({ title: $_('page.events.attendanceError') });
      }
    });
  }

  /** Add from the box: a new participant, or check in someone already registered */
  async function addMember({ member }: { member: Member }) {
    search = '';
    const existing = rows.find((r) => sameMember(r.participant.memberId, member.id));
    const name = `${member.lastname} ${member.firstname}`;
    if (existing) {
      if (tracking && !existing.attended && data.canWrite) {
        await setAttendance(existing.participant.memberId, true);
      } else {
        toaster.info({
          title: $_(
            existing.attended ? 'page.events.already_attended' : 'page.events.already_on_list',
            {
              values: { name }
            }
          )
        });
      }
      return;
    }

    await withBusy(member.id, async () => {
      const { data: added, error } = await supabaseClient
        .from('event_participants')
        .insert({
          eventId: data.event.id,
          memberId: member.id,
          attendanceStatus: tracking ? 'attended' : 'registered'
        })
        .select('*, members:memberId (id, firstname, lastname, labels, img)')
        .single();
      if (error || !added) {
        console.error('Error adding participant:', error);
        toaster.error({ title: $_('page.events.addParticipantError') });
        return;
      }
      participants = [...participants, added as unknown as EventParticipantRow];
      if (!tracking) return;

      // From the event day on, whoever is added was there
      const { data: log, error: logError } = await supabaseClient
        .from('event_logs')
        .insert({ eventId: data.event.id, memberId: member.id, attendedAt: attendedAt() })
        .select()
        .single();
      if (logError || !log) {
        console.error('Error marking attendance:', logError);
        toaster.error({ title: $_('page.events.attendanceError') });
        setParticipantStatus(String(member.id), 'registered');
        await supabaseClient
          .from('event_participants')
          .update({ attendanceStatus: 'registered' })
          .eq('eventId', data.event.id)
          .eq('memberId', member.id);
        return;
      }
      logs = [...logs, log as EventLog];
    });
  }

  /** Take someone off the list, with their attendance (a mistaken check-in) */
  function removeParticipant(memberId: string) {
    return withBusy(memberId, async () => {
      if (logs.some((l) => sameMember(l.memberId, memberId))) {
        const { error } = await supabaseClient
          .from('event_logs')
          .delete()
          .eq('eventId', data.event.id)
          .eq('memberId', memberId);
        if (error) {
          console.error('Error removing attendance:', error);
          toaster.error({ title: $_('page.events.removeParticipantError') });
          return;
        }
        logs = logs.filter((l) => !sameMember(l.memberId, memberId));
      }
      const { error } = await supabaseClient
        .from('event_participants')
        .delete()
        .eq('eventId', data.event.id)
        .eq('memberId', memberId);
      if (error) {
        console.error('Error removing participant:', error);
        toaster.error({ title: $_('page.events.removeParticipantError') });
        return;
      }
      participants = participants.filter((p) => !sameMember(p.memberId, memberId));
    });
  }

  /** Change an attendance row in place (coach, coaching day) */
  function updateLog(memberId: string, change: Partial<Pick<EventLog, 'isCoach' | 'coachDay'>>) {
    return withBusy(memberId, async () => {
      const before = logs;
      logs = logs.map((l) => (sameMember(l.memberId, memberId) ? { ...l, ...change } : l));
      const { error } = await supabaseClient
        .from('event_logs')
        .update(change)
        .eq('eventId', data.event.id)
        .eq('memberId', memberId);
      if (error) {
        console.error('Error saving coach status:', error);
        logs = before;
        toaster.error({ title: $_('page.events.coachError') });
      }
    });
  }

  function toggleCoach(row: Row) {
    if (!row.log) return; // Must be attending to be a coach
    return updateLog(row.participant.memberId, { isCoach: !row.log.isCoach });
  }

  /** A coach coached a full day or a half day (of every day of the event) */
  function setCoachDay(memberId: string, coachDay: CoachDay) {
    return updateLog(memberId, { coachDay });
  }

  /** Record, change, or clear a participant's placement at this event. */
  function setMedal(memberId: string, medal: Medal | null) {
    return withBusy(memberId, async () => {
      const existing = medals.find((m) => sameMember(m.memberId, memberId));
      if (existing && medal === null) {
        const { error } = await supabaseClient.from('member_medals').delete().eq('id', existing.id);
        if (error) return medalError(error);
        medals = medals.filter((m) => m !== existing);
      } else if (existing && medal) {
        const { error } = await supabaseClient
          .from('member_medals')
          .update({ medal })
          .eq('id', existing.id);
        if (error) return medalError(error);
        medals = medals.map((m) => (m === existing ? { ...m, medal } : m));
      } else if (medal) {
        const { data: saved, error } = await supabaseClient
          .from('member_medals')
          .insert({
            memberId,
            eventId: data.event.id,
            competition: data.event.title,
            date: data.event.date,
            section: data.event.section,
            medal
          })
          .select()
          .single();
        if (error) return medalError(error);
        medals = [...medals, saved as MemberMedal];
      }
    });
  }

  function medalError(error: unknown) {
    console.error('Error saving placement:', error);
    toaster.error({ title: $_('medals.saveError') });
  }

  // The search over the list: Enter checks the first match in and empties the
  // search for the next name (never out: that would drop a coach's status),
  // Escape empties it
  function searchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      search = '';
    } else if (e.key === 'Enter' && search.trim()) {
      e.preventDefault();
      const first = shownRows[0];
      if (first && !first.attended && tracking && data.canWrite) {
        setAttendance(first.participant.memberId, true);
        search = '';
      }
    }
  }

  function confirmDelete() {
    showDeleteConfirm = true;
  }

  async function handleDeleteResponse(confirmed: boolean) {
    showDeleteConfirm = false;
    if (!confirmed) return;

    isDeleting = true;
    try {
      // Registrations and attendance go with it (ON DELETE CASCADE). Deleting
      // them first would lose them when the database refuses the event
      // itself (an event its provider maintains).
      const { error } = await supabaseClient.from('events').delete().eq('id', data.event.id);

      if (error) {
        throw error;
      }

      // Show success toast
      toaster.success({ title: $_('page.events.deleteSuccess') });

      // Navigate back to events list
      await goto('/dashboard/events');
    } catch (error) {
      console.error('Error deleting event:', error);
      toaster.error({
        title: isManagedByProviderError(error)
          ? $_('page.events.managedBy', { values: { provider: provider ?? 'Webling' } })
          : $_('page.events.deleteError')
      });
    } finally {
      isDeleting = false;
    }
  }

  let registeredCount = $derived(participants.length);
  let attendedCount = $derived(logs.length);
  let coachCount = $derived(logs.filter((l) => l.isCoach).length);
  let attendanceRate = $derived(calculateAttendanceRate(registeredCount, attendedCount));
  let showAddBox = $derived(canAddParticipants(data.event, registeredCount, data.canWrite));
</script>

<div>
  <!-- Header: back + title + actions -->
  <div class="page-header-back">
    <a
      href="/dashboard/events"
      class="btn preset-tonal-surface flex-shrink-0"
      title={$_('page.events.backToList')}
      aria-label={$_('page.events.backToList')}
    >
      <Fa icon={faArrowLeft} />
    </a>
    <h1 class="flex-1 min-w-0 truncate">{data.event.title}</h1>
    {#if data.canWrite}
      <div class="flex gap-2 flex-shrink-0">
        <a
          href="/dashboard/events/{data.event.id}/edit"
          class="btn preset-tonal-surface"
          title={$_('button.edit')}
          aria-label={$_('button.edit')}
        >
          <Fa icon={faEdit} />
        </a>
        {#if canDelete}
          <MoreMenu>
            {#snippet items(close)}
              <button
                class="btn w-full justify-start text-error-600-400"
                onclick={() => {
                  close();
                  confirmDelete();
                }}
                disabled={isDeleting}
              >
                <Fa icon={faTrash} />
                <span>{$_('button.delete')}</span>
              </button>
            {/snippet}
          </MoreMenu>
        {/if}
      </div>
    {/if}
  </div>

  {#if provider}
    <div
      class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-surface-300-700 bg-surface-100-900 px-3 py-2 text-sm"
    >
      <span class="flex flex-1 items-center gap-2 min-w-0">
        <Fa icon={faArrowsRotate} class="text-surface-500 flex-shrink-0" />
        <span>{$_('page.events.managedBy', { values: { provider } })}</span>
      </span>
      {#if data.eventLink?.url}
        <a
          class="btn btn-sm preset-tonal-surface"
          href={data.eventLink.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{$_('page.events.openInProvider', { values: { provider } })}</span>
          <Fa icon={faArrowUpRightFromSquare} size="xs" />
        </a>
      {/if}
    </div>
  {/if}

  <!-- Metadata -->
  <div class="mb-6">
    <div class="flex flex-wrap gap-3 text-sm text-surface-600-400">
      <span class="meta-item">
        <Fa icon={faCalendarDays} size="sm" />
        {formatEventDates(data.event)}
      </span>
      {#if data.event.all_day}
        <span class="meta-item">
          <Fa icon={faClock} size="sm" />
          {$_('page.events.allDay')}
        </span>
      {:else if data.event.timeFrom}
        <span class="meta-item">
          <Fa icon={faClock} size="sm" />
          {formatTime(data.event.timeFrom)}{#if data.event.timeTo}
            - {formatTime(data.event.timeTo)}{/if}
        </span>
      {/if}
      {#if data.event.location}
        <span class="meta-item">
          <Fa icon={faLocationDot} size="sm" />
          {data.event.location}
        </span>
      {/if}
      <span class="meta-item">
        <Fa icon={faUsers} size="sm" />
        {data.event.section}
      </span>
    </div>
  </div>

  {#if showDeleteConfirm}
    <ConfirmDialog
      title={$_('page.events.deleteConfirmTitle')}
      message={`${$_('page.events.deleteConfirmMessage')} "${data.event.title}"?`}
      confirmLabel={$_('button.delete')}
      oncancel={() => handleDeleteResponse(false)}
      onconfirm={() => handleDeleteResponse(true)}
    />
  {/if}

  <!-- Event Description -->
  {#if data.event.description}
    <div class="mb-4">
      <h3>{$_('page.events.description')}</h3>
      <p class="text-sm text-surface-700-300 break-words">{data.event.description}</p>
    </div>
  {/if}

  <!-- Event Statistics -->
  <div class="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
    <div class="card p-3 sm:p-4 text-center">
      <div class="sm:text-xl font-bold text-primary-600-400">{registeredCount}</div>
      <div class="text-xs text-surface-600-400">{$_('page.events.stats.registered')}</div>
    </div>
    <div class="card p-3 sm:p-4 text-center">
      <div class="sm:text-xl font-bold text-success-600-400">{attendedCount}</div>
      <div class="text-xs text-surface-600-400">{$_('page.events.stats.attended')}</div>
    </div>
    <div class="card p-3 sm:p-4 text-center">
      <div class="sm:text-xl font-bold text-tertiary-600-400">{attendanceRate}%</div>
      <div class="text-xs text-surface-600-400">{$_('page.events.stats.attendance_rate')}</div>
    </div>
  </div>

  <!-- Registration Status -->
  {#if data.event.registrationDeadline}
    <div class="mb-4">
      <h3>{$_('page.events.registration_info')}</h3>
      <p class="text-sm">
        <strong>{$_('page.events.registration_deadline')}:</strong>
        {formatEventDate(data.event.registrationDeadline)}
        {#if !isRegistrationOpen()}
          <span class="text-error-600-400 ml-2">({$_('page.events.registration_closed')})</span>
        {/if}
      </p>
      {#if data.event.maxParticipants}
        <p class="text-sm mt-1">
          <strong>{$_('page.events.max_participants')}:</strong>
          {data.event.maxParticipants}
          {#if registeredCount >= data.event.maxParticipants}
            <span class="text-warning-600-400 ml-2">({$_('page.events.event_full')})</span>
          {/if}
        </p>
      {/if}
    </div>
  {/if}

  <!-- Participants: the check-in list, as on the training check-in -->
  <div>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <h3 class="mr-auto">{$_('page.events.participants')}</h3>
      {#if tracking && registeredCount > 0}
        <span
          class="chip bg-surface-100-900 text-surface-900-50"
          title={$_('page.events.stats.attended')}
        >
          <Fa icon={faUserCheck} size="sm" />
          <span>{attendedCount} / {registeredCount}</span>
        </span>
        {#if coachCount > 0}
          <span class="chip bg-surface-100-900 text-surface-900-50" title={$_('page.events.coach')}>
            <img class="inline-block w-3.5" src="/judo-icon.svg" alt={$_('page.events.coach')} />
            <span>{coachCount}</span>
          </span>
        {/if}
      {/if}
    </div>

    {#if registeredCount > 0}
      <!-- Search over the list -->
      <div class="sticky top-0 z-30 bg-surface-50-950 pb-3 -mx-3 px-3 sm:-mx-4 sm:px-4 pt-1">
        <input
          class="input"
          type="search"
          placeholder={$_('page.trainings.searchMembersPlaceholder')}
          bind:value={search}
          onkeydown={searchKeydown}
          onfocus={() => (animateList = false)}
          onblur={() => (animateList = true)}
        />
      </div>
    {:else}
      <p class="empty-state">{$_('page.events.no_participants')}</p>
    {/if}

    <ul class="flex flex-col gap-2">
      {#each shownRows as row (row.participant.memberId)}
        {@const memberId = row.participant.memberId}
        {@const log = row.log}
        {@const saving = busy.has(String(memberId))}
        <li
          class="list-item flex-wrap gap-y-2"
          animate:flip={{ duration: animateList ? 400 : 0, easing: quintInOut }}
        >
          {#if tracking}
            <input
              class="checkbox"
              type="checkbox"
              checked={row.attended}
              onchange={() => setAttendance(memberId, !row.attended)}
              disabled={!data.canWrite || saving}
              aria-label={$_('page.events.mark_attended')}
            />
          {/if}
          <div class="relative flex-shrink-0">
            {#if row.member.img}
              <img
                src={row.member.img}
                alt="{row.member.lastname} {row.member.firstname}"
                class="size-10 rounded-full object-cover"
              />
            {:else}
              <div class="avatar-initials">
                {row.member.lastname.charAt(0)}{row.member.firstname.charAt(0)}
              </div>
            {/if}
            {#if log?.isCoach}
              <span
                class="absolute -bottom-0 -right-0 z-10 bg-primary-600-400 rounded-full w-4 h-4 flex items-center justify-center"
              >
                <img class="w-2.5" src="/judo-icon.svg" alt={$_('page.events.coach')} />
              </span>
            {/if}
          </div>
          <div class="list-item-content">
            <div class="font-medium truncate">
              {row.member.lastname}
              {row.member.firstname}
              {#if row.placement}
                <span class="ml-1" title={$_('medals.' + row.placement.medal)}>
                  {medalEmoji(row.placement.medal)}
                </span>
              {/if}
            </div>
            <div class="flex flex-wrap items-center gap-x-2 text-sm text-surface-600-400">
              {#if log}
                <span>
                  {$_('page.events.attended_at')}
                  {dayjs(log.attendedAt).format('HH:mm')}
                </span>
              {:else}
                <span>{$_('page.events.status.' + row.participant.attendanceStatus)}</span>
              {/if}
              {#if log?.isCoach}
                <span class="badge preset-tonal-primary text-xs">
                  {$_('page.events.coach')}
                  {#if log.coachDay === 'half'}
                    · {$_('page.events.coach_half_day')}
                  {/if}
                </span>
              {/if}
            </div>
          </div>
          {#if data.canWrite && log}
            <!-- On a phone the placement and coaching day go on a line of their own -->
            <div
              class="order-last flex w-full items-center justify-end gap-2 sm:order-none sm:w-auto"
            >
              <!-- Placement: a medal for this event, once the participant has attended -->
              <div
                class="flex rounded-lg overflow-hidden border border-surface-300-700"
                title={$_('medals.placement')}
              >
                {#each MEDALS as m (m)}
                  <button
                    class="px-2 min-h-[44px] {row.placement?.medal === m
                      ? 'preset-filled-primary-500'
                      : 'preset-tonal-surface'}"
                    onclick={() => setMedal(memberId, row.placement?.medal === m ? null : m)}
                    disabled={saving}
                    title={$_('medals.' + m)}
                    aria-pressed={row.placement?.medal === m}
                  >
                    {medalEmoji(m)}
                  </button>
                {/each}
              </div>
              <!-- A coach coached a full day (default) or half a day -->
              {#if log.isCoach}
                <div
                  class="flex rounded-lg overflow-hidden border border-surface-300-700"
                  role="group"
                  aria-label={$_('page.events.coach_day')}
                  title={$_('page.events.coach_day')}
                >
                  {#each ['full', 'half'] as const as day (day)}
                    <button
                      class="px-2 min-h-[44px] text-sm {log.coachDay === day
                        ? 'preset-filled-primary-500'
                        : 'preset-tonal-surface'}"
                      onclick={() => log.coachDay !== day && setCoachDay(memberId, day)}
                      disabled={saving}
                      aria-pressed={log.coachDay === day}
                      title={$_('page.events.coach_' + day + '_day')}
                    >
                      {day === 'full' ? '1' : '½'}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          <div class="flex-shrink-0">
            <MoreMenu>
              {#snippet items(close)}
                <a
                  href="/dashboard/members/{memberId}"
                  class="btn w-full justify-start"
                  onclick={close}
                >
                  <Fa icon={faUser} />
                  <span>{$_('components.ParticipantCard.View')}</span>
                </a>
                {#if data.canWrite}
                  {#if log}
                    <button
                      class="btn w-full justify-start"
                      onclick={() => {
                        close();
                        toggleCoach(row);
                      }}
                      disabled={saving}
                    >
                      <Fa icon={faChalkboardTeacher} />
                      <span>
                        {log.isCoach
                          ? $_('page.events.remove_coach')
                          : $_('page.events.make_coach')}
                      </span>
                    </button>
                  {/if}
                  <button
                    class="btn w-full justify-start text-error-600-400"
                    onclick={() => {
                      close();
                      confirmRemoveId = memberId;
                    }}
                    disabled={saving}
                  >
                    <Fa icon={faUserMinus} />
                    <span>{$_('page.events.removeParticipant')}</span>
                  </button>
                {/if}
              {/snippet}
            </MoreMenu>
          </div>
        </li>
      {/each}
      {#if showAddBox}
        <li>
          <div class="flex flex-col gap-2 p-4 rounded-lg preset-tonal-tertiary w-full">
            <AddMemberInputBox
              onadd={addMember}
              placeholder={$_('page.events.add_participant_placeholder')}
            />
            {#if tracking}
              <p class="text-xs">{$_('page.events.add_as_attended_hint')}</p>
            {/if}
          </div>
        </li>
      {/if}
    </ul>
  </div>
</div>

{#if confirmRemoveId}
  <ConfirmDialog
    title={$_('page.events.removeParticipant')}
    message={$_('page.events.removeParticipantConfirm', {
      values: { name: memberName(confirmRemoveId) }
    })}
    confirmLabel={$_('button.remove')}
    oncancel={() => (confirmRemoveId = null)}
    onconfirm={() => {
      const memberId = confirmRemoveId!;
      confirmRemoveId = null;
      removeParticipant(memberId);
    }}
  />
{/if}
