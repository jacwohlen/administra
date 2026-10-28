<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faLocationDot,
    faUsers,
    faChevronRight
  } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import type { Event } from '$lib/models';
  import { eventPhase, formatEventDates, type EventPhase } from '$lib/eventUtils';
  import CreateButton from '$lib/components/assistant/CreateButton.svelte';
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

  const today = dayjs().format('YYYY-MM-DD');

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

  // Today (also a multi-day event under way), upcoming, past once its last day is over
  let byPhase = $derived.by(() => {
    const groups: Record<EventPhase, Event[]> = { today: [], upcoming: [], past: [] };
    for (const event of filteredEvents) groups[eventPhase(event, today)].push(event);
    return groups;
  });
  const PHASES: EventPhase[] = ['today', 'upcoming', 'past'];
</script>

{#snippet eventItem(event: Event)}
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
            {formatEventDates(event)}
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
{/snippet}

<div class="page-header">
  <h1>{$_('page.events.title')}</h1>
  {#if data.canWrite}
    <CreateButton
      href="/dashboard/events/new"
      label={$_('page.events.create_event')}
      assistantLabel={$_('assistant.kinds.events.title')}
      onassistant={() => (showAssistant = true)}
    />
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
    {#each PHASES as phase (phase)}
      {#if byPhase[phase].length > 0}
        <section>
          <h3>{$_(`page.events.${phase}`)}</h3>
          <ul class="flex flex-col gap-2">
            {#each byPhase[phase] as event (event.id)}
              {@render eventItem(event)}
            {/each}
          </ul>
        </section>
      {/if}
    {/each}
  </div>
{/if}
