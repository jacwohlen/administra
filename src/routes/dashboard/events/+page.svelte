<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faLocationDot,
    faUsers,
    faPlus,
    faChevronRight
  } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import AssistantButton from '$lib/components/assistant/AssistantButton.svelte';
  import AssistantDialog from '$lib/components/assistant/AssistantDialog.svelte';
  import EventsReview from '$lib/components/assistant/EventsReview.svelte';
  import { takeAssistantRequest } from '$lib/assistant/autoOpen';
  import { loadAssistantStatus } from '$lib/assistant/client';

  let { data }: { data: PageData } = $props();

  let searchTerm = $state('');
  let showAssistant = $state(false);

  // Opened from the Daten-Assistent overview with ?assistant=events
  onMount(() => {
    if (!takeAssistantRequest('events') || !data.canWrite) return;
    loadAssistantStatus().then((s) => (showAssistant = s.configured));
  });

  /** The review saved part of the events and stays open: reload the list once it closes */
  let assistantSavedSome = false;

  async function assistantApplied() {
    assistantSavedSome = false;
    // Closed first, so the review does not show the new events as duplicates of themselves
    showAssistant = false;
    await invalidateAll();
  }

  function closeAssistant() {
    showAssistant = false;
    if (!assistantSavedSome) return;
    assistantSavedSome = false;
    invalidateAll().catch((err) =>
      console.error('Error reloading the events after the assistant:', err)
    );
  }

  function formatEventDate(date: string) {
    return dayjs(date).format('DD.MM.YYYY');
  }

  function isUpcoming(date: string) {
    return dayjs(date).isAfter(dayjs(), 'day');
  }

  function isPast(date: string) {
    return dayjs(date).isBefore(dayjs(), 'day');
  }

  function isToday(date: string) {
    return dayjs(date).isSame(dayjs(), 'day');
  }

  // Filter events based on search term - make it reactive
  let filteredEvents = $derived(
    data.events.filter((event) => {
      if (!searchTerm.trim()) return true;

      const search = searchTerm.toLowerCase().trim();
      const title = event.title?.toLowerCase() || '';
      const description = event.description?.toLowerCase() || '';
      const section = event.section?.toLowerCase() || '';
      const location = event.location?.toLowerCase() || '';

      return (
        title.includes(search) ||
        description.includes(search) ||
        section.includes(search) ||
        location.includes(search)
      );
    })
  );
</script>

<div class="page-header">
  <h1>{$_('page.events.title')}</h1>
  {#if data.canWrite}
    <div class="flex flex-wrap justify-end gap-2">
      <AssistantButton
        label={$_('assistant.kinds.events.title')}
        onclick={() => (showAssistant = true)}
      />
      <a href="/dashboard/events/new" class="btn preset-filled-primary-500">
        <Fa icon={faPlus} />
        <span>{$_('page.events.create_event')}</span>
      </a>
    </div>
  {/if}
</div>

{#if showAssistant && data.canWrite}
  <AssistantDialog kind="events" onclose={closeAssistant}>
    {#snippet review(proposal, back)}
      <EventsReview
        {proposal}
        known={data.events}
        onback={back}
        oncancel={closeAssistant}
        onapplied={assistantApplied}
        onpartial={() => (assistantSavedSome = true)}
      />
    {/snippet}
  </AssistantDialog>
{/if}

<!-- Search Input -->
<div class="mb-4">
  <input
    class="input"
    bind:value={searchTerm}
    type="text"
    placeholder={$_('page.events.search_placeholder')}
  />
</div>

{#if data.events.length === 0}
  <p class="empty-state">{$_('page.events.no_events')}</p>
{:else if filteredEvents.length === 0 && searchTerm.trim()}
  <p class="empty-state">{$_('page.events.no_events_found')}</p>
{:else}
  <div class="space-y-6">
    <!-- Today's Events -->
    {#if filteredEvents.some((e) => isToday(e.date))}
      <section>
        <h3>{$_('page.events.today')}</h3>
        <ul class="flex flex-col gap-2">
          {#each filteredEvents.filter((e) => isToday(e.date)) as event (event.id)}
            <li>
              <a href="/dashboard/events/{event.id}" class="list-item list-item-link">
                <div class="relative inline-block flex-none">
                  <div class="entity-badge">
                    <Fa icon={faCalendarDays} size="lg" />
                  </div>
                </div>
                <span class="list-item-content">
                  <dt class="font-bold truncate">
                    {event.title}
                  </dt>
                  {#if event.description}
                    <dd class="text-surface-600-400 text-sm truncate">
                      {event.description}
                    </dd>
                  {/if}
                  <dd class="flex items-center gap-2 text-sm text-surface-600-400">
                    <span class="meta-item">
                      <Fa icon={faCalendarDays} size="sm" />
                      {formatEventDate(event.date)}
                    </span>
                    {#if event.location}
                      <span class="meta-item truncate">
                        <Fa icon={faLocationDot} size="sm" />
                        {event.location}
                      </span>
                    {/if}
                    <span class="meta-item">
                      <Fa icon={faUsers} size="sm" />
                      {event.section}
                    </span>
                  </dd>
                </span>
                <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Upcoming Events -->
    {#if filteredEvents.some((e) => isUpcoming(e.date))}
      <section>
        <h3>
          {$_('page.events.upcoming')}
        </h3>
        <ul class="flex flex-col gap-2">
          {#each filteredEvents.filter((e) => isUpcoming(e.date)) as event (event.id)}
            <li>
              <a href="/dashboard/events/{event.id}" class="list-item list-item-link">
                <div class="relative inline-block flex-none">
                  <div class="entity-badge">
                    <Fa icon={faCalendarDays} size="lg" />
                  </div>
                </div>
                <span class="list-item-content">
                  <dt class="font-bold truncate">
                    {event.title}
                  </dt>
                  {#if event.description}
                    <dd class="text-surface-600-400 text-sm truncate">
                      {event.description}
                    </dd>
                  {/if}
                  <dd class="flex items-center gap-2 text-sm text-surface-600-400">
                    <span class="meta-item">
                      <Fa icon={faCalendarDays} size="sm" />
                      {formatEventDate(event.date)}
                    </span>
                    {#if event.location}
                      <span class="meta-item truncate">
                        <Fa icon={faLocationDot} size="sm" />
                        {event.location}
                      </span>
                    {/if}
                    <span class="meta-item">
                      <Fa icon={faUsers} size="sm" />
                      {event.section}
                    </span>
                  </dd>
                </span>
                <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Past Events -->
    {#if filteredEvents.some((e) => isPast(e.date))}
      <section>
        <h3>{$_('page.events.past')}</h3>
        <ul class="flex flex-col gap-2">
          {#each filteredEvents.filter((e) => isPast(e.date)) as event (event.id)}
            <li>
              <a href="/dashboard/events/{event.id}" class="list-item list-item-link">
                <div class="relative inline-block flex-none">
                  <div class="entity-badge">
                    <Fa icon={faCalendarDays} size="lg" />
                  </div>
                </div>
                <span class="list-item-content">
                  <dt class="font-bold truncate">
                    {event.title}
                  </dt>
                  {#if event.description}
                    <dd class="text-surface-600-400 text-sm truncate">
                      {event.description}
                    </dd>
                  {/if}
                  <dd class="flex items-center gap-2 text-sm text-surface-600-400">
                    <span class="meta-item">
                      <Fa icon={faCalendarDays} size="sm" />
                      {formatEventDate(event.date)}
                    </span>
                    {#if event.location}
                      <span class="meta-item truncate">
                        <Fa icon={faLocationDot} size="sm" />
                        {event.location}
                      </span>
                    {/if}
                    <span class="meta-item">
                      <Fa icon={faUsers} size="sm" />
                      {event.section}
                    </span>
                  </dd>
                </span>
                <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}
