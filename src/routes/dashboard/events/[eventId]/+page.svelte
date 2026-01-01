<script lang="ts">
  import type { PageData } from './$types';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { modalStore, toastStore } from '@skeletonlabs/skeleton';
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

  export let data: PageData;

  let showAddParticipant = false;
  let loading = false;
  let isDeleting = false;

  function formatEventDate(date: string) {
    return dayjs(date).format('DD.MM.YYYY');
  }

  function formatTime(time: string | undefined) {
    return time || '';
  }

  function isEventPast() {
    return dayjs(data.event.date).isBefore(dayjs(), 'day');
  }

  function canTrackAttendance() {
    // Allow attendance tracking on the event day or after
    const eventDate = dayjs(data.event.date);
    const today = dayjs();
    return eventDate.isSame(today, 'day') || eventDate.isBefore(today, 'day');
  }

  function isRegistrationOpen() {
    if (!data.event.registrationDeadline) return true;
    return dayjs().isBefore(dayjs(data.event.registrationDeadline));
  }

  function getMemberById(id: string) {
    return data.allMembers.find((m) => m.id === id);
  }

  function getLogByMemberId(memberId: string) {
    return data.logs.find((l) => l.memberId === memberId);
  }

  async function onParticipantAdded() {
    await invalidateAll();
    showAddParticipant = false;
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
    const modal = {
      type: 'confirm',
      title: $_('page.events.deleteConfirmTitle'),
      body: `${$_('page.events.deleteConfirmMessage')} "${data.event.title}"?`,
      buttonTextConfirm: $_('button.delete'),
      buttonTextCancel: $_('button.cancel'),
      response: handleDeleteResponse
    };
    modalStore.trigger(modal);
  }

  async function handleDeleteResponse(confirmed: boolean) {
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
      toastStore.trigger({
        message: $_('page.events.deleteSuccess'),
        background: 'variant-filled-success',
        timeout: 4000
      });

      // Navigate back to events list
      await goto('/dashboard/events');
    } catch (error) {
      console.error('Error deleting event:', error);
      toastStore.trigger({
        message: $_('page.events.deleteError'),
        background: 'variant-filled-error',
        timeout: 6000
      });
    } finally {
      isDeleting = false;
    }
  }

  // Get existing participant member IDs for the search component
  $: existingParticipantIds = data.participants.map((p) => p.memberId);

  $: registeredCount = data.participants.length;
  $: attendedCount = data.logs.length;
  $: attendanceRate = registeredCount > 0 ? Math.round((attendedCount / registeredCount) * 100) : 0;
</script>

<div class="max-w-4xl mx-auto">
  <!-- Header -->
  <div class="flex items-center gap-4 mb-6">
    <a href="/dashboard/events" class="btn variant-ghost-surface">
      <Fa icon={faArrowLeft} />
    </a>
    <div class="flex-grow">
      <h1>{data.event.title}</h1>
      <div class="flex flex-wrap gap-4 mt-2 text-sm text-gray-600">
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
    <div class="flex gap-2">
      <a href="/dashboard/events/{data.event.id}/edit" class="btn btn-sm variant-ghost-surface">
        <Fa icon={faEdit} />
        <span>{$_('button.edit')}</span>
      </a>
      <button class="btn btn-sm variant-ghost-error" on:click={confirmDelete} disabled={isDeleting}>
        {#if isDeleting}
          <span class="animate-spin">⏳</span>
          <span>{$_('button.deleting')}</span>
        {:else}
          <Fa icon={faTrash} />
          <span>{$_('button.delete')}</span>
        {/if}
      </button>
    </div>
  </div>

  <!-- Event Description -->
  {#if data.event.description}
    <div class="card p-4 mb-6">
      <h2 class="font-semibold mb-2">{$_('page.events.description')}</h2>
      <p class="text-gray-700 break-words">{data.event.description}</p>
    </div>
  {/if}

  <!-- Event Statistics -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
    <div class="card p-4 text-center">
      <div class="text-2xl font-bold text-primary-500">{registeredCount}</div>
      <div class="text-sm text-gray-600">{$_('page.events.stats.registered')}</div>
    </div>
    <div class="card p-4 text-center">
      <div class="text-2xl font-bold text-success-500">{attendedCount}</div>
      <div class="text-sm text-gray-600">{$_('page.events.stats.attended')}</div>
    </div>
    <div class="card p-4 text-center">
      <div class="text-2xl font-bold text-tertiary-500">{attendanceRate}%</div>
      <div class="text-sm text-gray-600">{$_('page.events.stats.attendance_rate')}</div>
    </div>
  </div>

  <!-- Registration Status -->
  {#if data.event.registrationDeadline}
    <div class="card p-4 mb-6">
      <h2 class="font-semibold mb-2">{$_('page.events.registration_info')}</h2>
      <p class="text-sm">
        <strong>{$_('page.events.registration_deadline')}:</strong>
        {formatEventDate(data.event.registrationDeadline)}
        {#if !isRegistrationOpen()}
          <span class="text-error-500 ml-2">({$_('page.events.registration_closed')})</span>
        {/if}
      </p>
      {#if data.event.maxParticipants}
        <p class="text-sm mt-1">
          <strong>{$_('page.events.max_participants')}:</strong>
          {data.event.maxParticipants}
          {#if registeredCount >= data.event.maxParticipants}
            <span class="text-warning-500 ml-2">({$_('page.events.event_full')})</span>
          {/if}
        </p>
      {/if}
    </div>
  {/if}

  <!-- Participants Section -->
  <div class="card p-6">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-semibold">{$_('page.events.participants')}</h2>
      {#if !isEventPast() && isRegistrationOpen() && (!data.event.maxParticipants || registeredCount < data.event.maxParticipants)}
        <button
          class="btn btn-sm variant-filled-primary"
          on:click={() => (showAddParticipant = !showAddParticipant)}
          disabled={loading}
        >
          <Fa icon={faUserPlus} />
          <span>{$_('page.events.add_participant')}</span>
        </button>
      {/if}
    </div>

    <!-- Add Participant Search -->
    {#if showAddParticipant}
      <div class="bg-surface-100-800-token p-4 rounded-lg mb-4">
        <div class="flex gap-4 items-center">
          <div class="flex-grow">
            <AddEventParticipant
              eventId={data.event.id}
              existingParticipants={existingParticipantIds}
              on:added={onParticipantAdded}
            />
          </div>
          <button class="btn variant-ghost-surface" on:click={() => (showAddParticipant = false)}>
            {$_('button.cancel')}
          </button>
        </div>
      </div>
    {/if}

    <!-- Participants List -->
    {#if data.participants.length === 0}
      <p class="text-center text-gray-500 py-8">{$_('page.events.no_participants')}</p>
    {:else}
      <div class="space-y-2">
        {#each data.participants as participant}
          {@const member = getMemberById(participant.memberId)}
          {@const log = getLogByMemberId(participant.memberId)}
          {@const hasAttended = !!log}
          {#if member}
            <div
              class="flex items-center justify-between p-3 border rounded-lg {hasAttended
                ? 'bg-success-50 border-success-200'
                : 'bg-gray-50'}"
            >
              <div class="flex items-center gap-3">
                <div class="relative">
                  {#if member.img}
                    <img
                      src={member.img}
                      alt="{member.firstname} {member.lastname}"
                      class="w-10 h-10 rounded-full object-cover"
                    />
                  {:else}
                    <div
                      class="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white font-semibold"
                    >
                      {member.firstname[0]}{member.lastname[0]}
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
                      <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded ml-2">
                        {$_('page.events.coach')}
                      </span>
                    {/if}
                  </div>
                  <div class="text-sm text-gray-600">
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
                        ? 'variant-filled-secondary'
                        : 'variant-ghost-secondary'}"
                      on:click={() => toggleCoach(participant.memberId)}
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
                      ? 'variant-filled-success'
                      : 'variant-ghost-success'}"
                    on:click={() => markAttendance(participant.memberId, !hasAttended)}
                    disabled={loading}
                  >
                    <Fa icon={faCheck} />
                  </button>
                {:else}
                  <!-- Future event - show remove button -->
                  <button
                    class="btn btn-sm variant-ghost-error"
                    on:click={() => removeParticipant(participant.memberId)}
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
