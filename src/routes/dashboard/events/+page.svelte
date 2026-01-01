<script lang="ts">
  import type { PageData } from './$types';
  import { Avatar } from '@skeletonlabs/skeleton';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faLocationDot,
    faUsers,
    faPlus,
    faGripLines
  } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';

  export let data: PageData;

  let searchTerm = '';

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
  $: filteredEvents = data.events.filter((event) => {
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
  });
</script>

<div class="flex justify-between items-center mb-6">
  <h1>{$_('page.events.title')}</h1>
  <a href="/dashboard/events/new" class="btn btn-sm variant-filled-primary">
    <Fa icon={faPlus} />
    <span>{$_('page.events.create_event')}</span>
  </a>
</div>

<!-- Search Input -->
<div class="mb-6">
  <input
    class="input"
    bind:value={searchTerm}
    type="text"
    placeholder={$_('page.events.search_placeholder')}
  />
</div>

{#if data.events.length === 0}
  <div class="text-center py-8">
    <p class="text-gray-500">{$_('page.events.no_events')}</p>
  </div>
{:else if filteredEvents.length === 0 && searchTerm.trim()}
  <div class="text-center py-8">
    <p class="text-gray-500">{$_('page.events.no_events_found')}</p>
  </div>
{:else}
  <div class="space-y-6">
    <!-- Today's Events -->
    {#if filteredEvents.some((e) => isToday(e.date))}
      <section>
        <h3 class="text-lg font-semibold mb-3 text-warning-500">{$_('page.events.today')}</h3>
        <ul class="list space-y-2">
          {#each filteredEvents.filter((e) => isToday(e.date)) as event (event.id)}
            <li class="flex items-start">
              <div class="relative inline-block flex-none">
                <Avatar
                  class="rounded-md"
                  initials={event.title.charAt(0) + event.title.charAt(1)}
                />
              </div>
              <span class="flex-1 min-w-0">
                <dt class="font-bold truncate">
                  {event.title}
                </dt>
                {#if event.description}
                  <dd class="text-gray-500 text-sm truncate">
                    {event.description}
                  </dd>
                {/if}
                <dd class="flex items-center gap-2 text-sm">
                  <span class="flex items-center gap-1">
                    <Fa icon={faCalendarDays} size="sm" />
                    {formatEventDate(event.date)}
                  </span>
                  {#if event.location}
                    <span class="flex items-center gap-1 truncate">
                      <Fa icon={faLocationDot} size="sm" />
                      {event.location}
                    </span>
                  {/if}
                  <span class="flex items-center gap-1">
                    <Fa icon={faUsers} size="sm" />
                    {event.section}
                  </span>
                </dd>
              </span>
              <span class="flex-none">
                <a class="btn btn-sm variant-filled-secondary" href="/dashboard/events/{event.id}">
                  <Fa icon={faGripLines} />
                  <span>{$_('button.view')}</span>
                </a>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Upcoming Events -->
    {#if filteredEvents.some((e) => isUpcoming(e.date))}
      <section>
        <h3 class="text-lg font-semibold mb-3 text-primary-500">{$_('page.events.upcoming')}</h3>
        <ul class="list space-y-2">
          {#each filteredEvents.filter((e) => isUpcoming(e.date)) as event (event.id)}
            <li class="flex items-start">
              <div class="relative inline-block flex-none">
                <Avatar
                  class="rounded-md"
                  initials={event.title.charAt(0) + event.title.charAt(1)}
                />
              </div>
              <span class="flex-1 min-w-0">
                <dt class="font-bold truncate">
                  {event.title}
                </dt>
                {#if event.description}
                  <dd class="text-gray-500 text-sm truncate">
                    {event.description}
                  </dd>
                {/if}
                <dd class="flex items-center gap-2 text-sm">
                  <span class="flex items-center gap-1">
                    <Fa icon={faCalendarDays} size="sm" />
                    {formatEventDate(event.date)}
                  </span>
                  {#if event.location}
                    <span class="flex items-center gap-1 truncate">
                      <Fa icon={faLocationDot} size="sm" />
                      {event.location}
                    </span>
                  {/if}
                  <span class="flex items-center gap-1">
                    <Fa icon={faUsers} size="sm" />
                    {event.section}
                  </span>
                </dd>
              </span>
              <span class="flex-none">
                <a class="btn btn-sm variant-filled-secondary" href="/dashboard/events/{event.id}">
                  <Fa icon={faGripLines} />
                  <span>{$_('button.view')}</span>
                </a>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Past Events -->
    {#if filteredEvents.some((e) => isPast(e.date))}
      <section>
        <h3 class="text-lg font-semibold mb-3 text-gray-500">{$_('page.events.past')}</h3>
        <ul class="list space-y-2">
          {#each filteredEvents.filter((e) => isPast(e.date)) as event (event.id)}
            <li class="flex items-start">
              <div class="relative inline-block flex-none">
                <Avatar
                  class="rounded-md"
                  initials={event.title.charAt(0) + event.title.charAt(1)}
                />
              </div>
              <span class="flex-1 min-w-0">
                <dt class="font-bold truncate">
                  {event.title}
                </dt>
                {#if event.description}
                  <dd class="text-gray-500 text-sm truncate">
                    {event.description}
                  </dd>
                {/if}
                <dd class="flex items-center gap-2 text-sm">
                  <span class="flex items-center gap-1">
                    <Fa icon={faCalendarDays} size="sm" />
                    {formatEventDate(event.date)}
                  </span>
                  {#if event.location}
                    <span class="flex items-center gap-1 truncate">
                      <Fa icon={faLocationDot} size="sm" />
                      {event.location}
                    </span>
                  {/if}
                  <span class="flex items-center gap-1">
                    <Fa icon={faUsers} size="sm" />
                    {event.section}
                  </span>
                </dd>
              </span>
              <span class="flex-none">
                <a class="btn btn-sm variant-filled-secondary" href="/dashboard/events/{event.id}">
                  <Fa icon={faGripLines} />
                  <span>{$_('button.view')}</span>
                </a>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}
