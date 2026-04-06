<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faClipboardCheck,
    faArrowRight,
    faArrowLeft,
    faCalendarDays,
    faLocationDot,
    faUsers
  } from '@fortawesome/free-solid-svg-icons';
  import type { Training, Event } from '$lib/models';
  import dayjs, { type Dayjs } from 'dayjs';
  import utils from '$lib/utils';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import RecentAchievements from '$lib/components/RecentAchievements.svelte';

  let date: Dayjs = utils.getMostRecentDateByWeekday(dayjs().day());
  const dateFormat = 'YYYY-MM-DD';
  let trainings: Training[] = [];
  let todayEvents: Event[] = [];

  function nextDay() {
    date = utils.getMostRecentDateByWeekday(date.add(1, 'days').day());
    getTrainingsForDay();
    getTodayEvents();
  }

  function previousDay() {
    date = utils.getMostRecentDateByWeekday(date.subtract(1, 'days').day());
    getTrainingsForDay();
    getTodayEvents();
  }

  function formatEventDate(date: string) {
    return dayjs(date).format('DD.MM.YYYY');
  }

  async function getTrainingsForDay() {
    const { data } = await supabaseClient
      .from('trainings')
      .select(`id, title, dateFrom, dateTo, weekday, section`)
      .eq('weekday', date.locale('en').format('dddd'))
      .returns<Training[]>();

    if (data) trainings = data;
  }

  async function getTodayEvents() {
    const today = date.format('YYYY-MM-DD');
    const { data } = await supabaseClient
      .from('events')
      .select('*')
      .eq('date', today)
      .order('timeFrom', { ascending: true })
      .returns<Event[]>();

    if (data) todayEvents = data;
  }

  getTrainingsForDay();
  getTodayEvents();
</script>

<div class="page-header">
  <div>
    <button class="btn" onclick={previousDay}>
      <Fa icon={faArrowLeft} /><span class="hidden sm:inline">{$_('button.day')}</span>
    </button>
  </div>
  <div>
    <h1>{date.format('dddd')}</h1>
  </div>
  <div>
    <button class="btn" onclick={nextDay}>
      <span class="hidden sm:inline">{$_('button.day')}</span><Fa icon={faArrowRight} />
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
          <span class="list-item-content">
            <dt class="font-bold truncate">{t.title}</dt>
          </span>
          <span class="flex-none">
            <a
              class="btn preset-tonal-primary"
              href="/dashboard/trainings/{t.id}/{date.format(dateFormat)}"
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
<section class="card p-4">
  <RecentAchievements />
</section>
