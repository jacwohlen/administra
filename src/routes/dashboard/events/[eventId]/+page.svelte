<script lang="ts">
  import type { PageData } from './$types';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { toaster } from '$lib/toast';
  import {
    faCalendarDays,
    faLocationDot,
    faClock,
    faUsers,
    faUserPlus,
    faCheck,
    faTimes,
    faArrowLeft,
    faEdit,
    faTrash,
    faChalkboardTeacher
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { invalidateAll, goto } from '$app/navigation';
  import AddEventParticipant from './AddEventParticipant.svelte';
  import {
    isEventPast as _isEventPast,
    canTrackAttendance as _canTrackAttendance,
    isRegistrationOpen as _isRegistrationOpen,
    calculateAttendanceRate
  } from '$lib/eventUtils';

  let { data }: { data: PageData } = $props();

  let showAddParticipant = $state(false);
  let loading = $state(false);
  let isDeleting = $state(false);
  let showDeleteConfirm = $state(false);

  function formatEventDate(date: string) {
    return dayjs(date).format('DD.MM.YYYY');
  }

  function formatTime(time: string | undefined) {
    return time || '';
  }

  function isEventPast() {
    return _isEventPast(data.event.date);
  }

  function canTrackAttendance() {
    return _canTrackAttendance(data.event.date);
  }

  function isRegistrationOpen() {
    return _isRegistrationOpen(data.event.registrationDeadline);
  }

  function getMemberById(id: string) {
    return data.allMembers.find((m) => m.id === id);
  }

  function getLogByMemberId(memberId: string) {
    return data.logs.find((l) => l.memberId === memberId);
  }

  async function onParticipantAdded() {
    await invalidateAll();
    // Keep the search area open so the user can add more participants
  }

  async function removeParticipant(memberId: string) {
    loading = true;
    try {
      const { error } = await supabaseClient
        .from('event_participants')
        .delete()
        .eq('eventId', data.event.id)
        .eq('memberId', memberId);

      if (error) {
        console.error('Error removing participant:', error);
        return;
      }

      await invalidateAll();
    } finally {
      loading = false;
    }
  }

  async function markAttendance(memberId: string, attended: boolean, isCoach: boolean) {
    loading = true;
    try {
      if (attended) {
        // Add to event_logs
        const { error } = await supabaseClient.from('event_logs').insert({
          eventId: data.event.id,
          memberId: memberId,
          isCoach: isCoach
        });

        if (error) {
          console.error('Error marking attendance:', error);
          return;
        }

        // Update participant status
        await supabaseClient
          .from('event_participants')
          .update({ attendanceStatus: 'attended' })
          .eq('eventId', data.event.id)
          .eq('memberId', memberId);
      } else {
        // Remove from event_logs
        const { error } = await supabaseClient
          .from('event_logs')
          .delete()
          .eq('eventId', data.event.id)
          .eq('memberId', memberId);

        if (error) {
          console.error('Error removing attendance:', error);
          return;
        }

        // Update participant status
        await supabaseClient
          .from('event_participants')
          .update({ attendanceStatus: 'registered' })
          .eq('eventId', data.event.id)
          .eq('memberId', memberId);
      }

      await invalidateAll();
    } finally {
      loading = false;
    }
  }

  async function toggleCoach(memberId: string) {
    loading = true;
    try {
      const log = getLogByMemberId(memberId);
      if (!log) return; // Must be attending to be a coach

      // Toggle coach status
      const { error } = await supabaseClient
        .from('event_logs')
        .update({ isCoach: !log.isCoach })
        .eq('eventId', data.event.id)
        .eq('memberId', memberId);

      if (error) {
        console.error('Error toggling coach status:', error);
        return;
      }

      await invalidateAll();
    } finally {
      loading = false;
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
      // Delete related records first (participants and logs)
      await supabaseClient.from('event_participants').delete().eq('eventId', data.event.id);

      await supabaseClient.from('event_logs').delete().eq('eventId', data.event.id);

      // Delete the event
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
      toaster.error({ title: $_('page.events.deleteError') });
    } finally {
      isDeleting = false;
    }
  }

  // Get existing participant member IDs for the search component
  let existingParticipantIds = $derived(data.participants.map((p) => p.memberId));

  let registeredCount = $derived(data.participants.length);
  let attendedCount = $derived(data.logs.length);
  let attendanceRate = $derived(calculateAttendanceRate(registeredCount, attendedCount));
</script>

<div>
  <!-- Header: back + title + actions -->
  <div class="flex items-center gap-2 mb-4">
    <a
      href="/dashboard/events"
      class="btn btn-sm preset-tonal-surface flex-shrink-0 min-w-[44px] min-h-[44px]"
    >
      <Fa icon={faArrowLeft} />
    </a>
    <h1 class="flex-1 min-w-0 truncate">{data.event.title}</h1>
    <div class="flex gap-2 flex-shrink-0">
      <a href="/dashboard/events/{data.event.id}/edit" class="btn btn-sm preset-tonal-surface">
        <Fa icon={faEdit} />
      </a>
      <button class="btn btn-sm preset-tonal-error" onclick={confirmDelete} disabled={isDeleting}>
        <Fa icon={faTrash} />
      </button>
    </div>
  </div>

  <!-- Metadata -->
  <div class="mb-6">
    <div class="flex flex-wrap gap-3 text-sm text-surface-600-400">
      <span class="flex items-center gap-1">
        <Fa icon={faCalendarDays} size="sm" />
        {formatEventDate(data.event.date)}
      </span>
      {#if data.event.timeFrom}
        <span class="flex items-center gap-1">
          <Fa icon={faClock} size="sm" />
          {formatTime(data.event.timeFrom)}{#if data.event.timeTo}
            - {formatTime(data.event.timeTo)}{/if}
        </span>
      {/if}
      {#if data.event.location}
        <span class="flex items-center gap-1">
          <Fa icon={faLocationDot} size="sm" />
          {data.event.location}
        </span>
      {/if}
      <span class="flex items-center gap-1">
        <Fa icon={faUsers} size="sm" />
        {data.event.section}
      </span>
    </div>
  </div>

  {#if showDeleteConfirm}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onclick={() => handleDeleteResponse(false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') handleDeleteResponse(false);
      }}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="card p-4 sm:p-6 w-full max-w-sm shadow-2xl bg-surface-50-950"
        onclick={(e) => e.stopPropagation()}
      >
        <h3 class="font-semibold text-lg mb-2">{$_('page.events.deleteConfirmTitle')}</h3>
        <p class="mb-4">{$_('page.events.deleteConfirmMessage')} "{data.event.title}"?</p>
        <div class="flex justify-end gap-2">
          <button class="btn preset-tonal-surface" onclick={() => handleDeleteResponse(false)}>
            {$_('button.cancel')}
          </button>
          <button class="btn preset-filled-error-500" onclick={() => handleDeleteResponse(true)}>
            {$_('button.delete')}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Event Description -->
  {#if data.event.description}
    <div class="mb-4">
      <h3 class="font-semibold mb-1">{$_('page.events.description')}</h3>
      <p class="text-sm text-surface-700-300 break-words">{data.event.description}</p>
    </div>
  {/if}

  <!-- Event Statistics -->
  <div class="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
    <div class="card p-3 sm:p-4 text-center">
      <div class="text-lg sm:text-xl font-bold text-primary-600-400">{registeredCount}</div>
      <div class="text-xs text-surface-600-400">{$_('page.events.stats.registered')}</div>
    </div>
    <div class="card p-3 sm:p-4 text-center">
      <div class="text-lg sm:text-xl font-bold text-success-600-400">{attendedCount}</div>
      <div class="text-xs text-surface-600-400">{$_('page.events.stats.attended')}</div>
    </div>
    <div class="card p-3 sm:p-4 text-center">
      <div class="text-lg sm:text-xl font-bold text-tertiary-600-400">{attendanceRate}%</div>
      <div class="text-xs text-surface-600-400">{$_('page.events.stats.attendance_rate')}</div>
    </div>
  </div>

  <!-- Registration Status -->
  {#if data.event.registrationDeadline}
    <div class="mb-4">
      <h3 class="font-semibold mb-1">{$_('page.events.registration_info')}</h3>
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

  <!-- Participants Section -->
  <div>
    <div class="flex justify-between items-center mb-3">
      <h3 class="font-semibold">{$_('page.events.participants')}</h3>
      {#if !isEventPast() && isRegistrationOpen() && (!data.event.maxParticipants || registeredCount < data.event.maxParticipants)}
        <button
          class="btn btn-sm preset-filled-primary-500"
          onclick={() => (showAddParticipant = !showAddParticipant)}
          disabled={loading}
        >
          <Fa icon={faUserPlus} />
          <span>{$_('page.events.add_participant')}</span>
        </button>
      {/if}
    </div>

    <!-- Add Participant Search -->
    {#if showAddParticipant}
      <div class="bg-surface-100-900 p-4 rounded-lg mb-4">
        <div class="flex gap-4 items-center">
          <div class="flex-grow">
            <AddEventParticipant
              eventId={data.event.id}
              existingParticipants={existingParticipantIds}
              onadded={onParticipantAdded}
            />
          </div>
          <button class="btn preset-tonal-surface" onclick={() => (showAddParticipant = false)}>
            {$_('button.cancel')}
          </button>
        </div>
      </div>
    {/if}

    <!-- Participants List -->
    {#if data.participants.length === 0}
      <p class="text-center text-surface-600-400 py-8">{$_('page.events.no_participants')}</p>
    {:else}
      <div class="space-y-2">
        {#each data.participants as participant}
          {@const member = getMemberById(participant.memberId)}
          {@const log = getLogByMemberId(participant.memberId)}
          {@const hasAttended = !!log}
          {#if member}
            <div
              class="flex items-center justify-between py-2 {hasAttended
                ? 'opacity-100'
                : 'opacity-70'}"
            >
              <div class="flex items-center gap-3">
                <div class="relative">
                  {#if member.img}
                    <img
                      src={member.img}
                      alt="{member.firstname} {member.lastname}"
                      class="size-10 rounded-full object-cover"
                    />
                  {:else}
                    <div
                      class="size-10 rounded-full bg-surface-100-900 flex items-center justify-center text-sm font-bold"
                    >
                      {member.lastname[0]}{member.firstname[0]}
                    </div>
                  {/if}
                  {#if log && log.isCoach}
                    <span class="badge-icon absolute -bottom-0 -right-0 z-10">
                      <img src="/judo-icon.svg" alt="Coach" class="w-4 h-4" />
                    </span>
                  {/if}
                </div>
                <div>
                  <div class="font-medium">
                    {member.firstname}
                    {member.lastname}
                    {#if log && log.isCoach}
                      <span class="badge preset-tonal-primary text-xs ml-2">
                        {$_('page.events.coach')}
                      </span>
                    {/if}
                  </div>
                  <div class="text-sm text-surface-600-400">
                    {$_('page.events.status.' + participant.attendanceStatus)}
                    {#if log}
                      - {$_('page.events.attended_at')} {dayjs(log.attendedAt).format('HH:mm')}
                    {/if}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                {#if canTrackAttendance()}
                  <!-- Coach toggle button - only show if participant has attended -->
                  {#if hasAttended}
                    <button
                      class="btn btn-sm {log && log.isCoach
                        ? 'preset-filled-primary-500'
                        : 'preset-tonal-primary'}"
                      onclick={() => toggleCoach(participant.memberId)}
                      disabled={loading}
                      title={log && log.isCoach
                        ? $_('page.events.remove_coach')
                        : $_('page.events.make_coach')}
                    >
                      <Fa icon={faChalkboardTeacher} />
                    </button>
                  {/if}
                  <!-- Event day or past - show attendance buttons -->
                  <button
                    class="btn btn-sm {hasAttended
                      ? 'preset-filled-success-500'
                      : 'preset-tonal-success'}"
                    onclick={() => markAttendance(participant.memberId, !hasAttended)}
                    disabled={loading}
                  >
                    <Fa icon={faCheck} />
                  </button>
                {:else}
                  <!-- Future event - show remove button -->
                  <button
                    class="btn btn-sm preset-tonal-error"
                    onclick={() => removeParticipant(participant.memberId)}
                    disabled={loading}
                  >
                    <Fa icon={faTimes} />
                  </button>
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>
