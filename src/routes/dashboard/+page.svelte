<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faClipboardCheck,
    faChevronRight,
    faChevronLeft,
    faCalendarDays,
    faLocationDot,
    faUsers
  } from '@fortawesome/free-solid-svg-icons';
  import type { Training, Event } from '$lib/models';
  import dayjs, { type Dayjs } from 'dayjs';
  import utils from '$lib/utils';
  import { _ } from 'svelte-i18n';
  import RecentAchievements from '$lib/components/RecentAchievements.svelte';
  import { formatTime } from '$lib/trainingUtils';
  import { formatEventDates } from '$lib/eventUtils';

  import type { PageData } from './$types';
  import { loadDayOverview } from './dayOverview';

  export let data: PageData;

  let date: Dayjs = dayjs(data.date);
  const dateFormat = 'YYYY-MM-DD';
  let trainings: Training[] = data.day.trainings;
  let todayEvents: Event[] = data.day.events;
  // Answers of an earlier day that arrive late are dropped
  let shown = 0;

  async function showDay(next: Dayjs) {
    date = next;
    const request = ++shown;
    const day = await loadDayOverview(next);
    if (request !== shown) return;
    trainings = day.trainings;
    todayEvents = day.events;
  }

  function nextDay() {
    showDay(utils.getMostRecentDateByWeekday(date.add(1, 'days').day()));
  }

  function previousDay() {
    showDay(utils.getMostRecentDateByWeekday(date.subtract(1, 'days').day()));
  }
</script>

<div class="page-header">
  <div>
    <button class="btn preset-tonal-surface" onclick={previousDay}>
      <Fa icon={faChevronLeft} /><span class="hidden sm:inline">{$_('button.day')}</span>
    </button>
  </div>
  <div>
    <h1>{date.format('dddd')}</h1>
  </div>
  <div>
    <button class="btn preset-tonal-surface" onclick={nextDay}>
      <span class="hidden sm:inline">{$_('button.day')}</span><Fa icon={faChevronRight} />
    </button>
  </div>
</div>

<!-- Trainings Section -->
<section class="mb-6">
  {#if trainings.length == 0}
    <div class="empty-state">
      {$_('page.dashboard.noTrainingsToday')}
    </div>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each trainings as t (t.id)}
        <li class="list-item">
          <span class="training-time">
            <span class="font-bold">{formatTime(t.dateFrom)}</span>
            {#if t.dateTo}
              <span class="text-xs text-surface-600-400">{formatTime(t.dateTo)}</span>
            {/if}
          </span>
          <span class="list-item-content">
            <dt class="font-bold truncate">{t.title}</dt>
            {#if t.section}
              <dd class="text-surface-600-400 text-sm truncate">{t.section}</dd>
            {/if}
          </span>
          <span class="flex-none">
            <a
              class="btn preset-tonal-primary"
              href="/dashboard/trainings/{t.id}/{date.format(dateFormat)}"
              aria-label={$_('button.trackAttendance')}
            >
              <Fa icon={faClipboardCheck} />
              <span class="hidden sm:inline">{$_('button.trackAttendance')}</span>
            </a>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<!-- Today's Events Section -->
<section class="mb-6">
  {#if todayEvents.length > 0}
    <ul class="flex flex-col gap-2">
      {#each todayEvents as event (event.id)}
        <li class="list-item">
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
          <span class="flex-none">
            <a class="btn preset-tonal-primary" href="/dashboard/events/{event.id}">
              <Fa icon={faClipboardCheck} />
              <span class="hidden sm:inline">{$_('button.trackAttendance')}</span>
            </a>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<!-- Recent Achievements Section -->
<section>
  <RecentAchievements />
</section>

<style>
  .training-time {
    flex: none;
    width: 3.25rem;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    font-variant-numeric: tabular-nums;
  }
</style>
