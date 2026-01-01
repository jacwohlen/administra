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

<div class="flex justify-between items-center m-2">
  <div>
    <button class="btn" on:click={previousDay}>
      <Fa icon={faArrowLeft} /><span>{$_('button.day')}</span>
    </button>
  </div>
  <div>
    <h1>{date.format('dddd')}</h1>
  </div>
  <div>
    <button class="btn" on:click={nextDay}>
      <span>{$_('button.day')}</span><Fa icon={faArrowRight} />
    </button>
  </div>
</div>

<!-- Trainings Section -->
<section class="mb-6">
  {#if trainings.length == 0}
    <div class="text-center text-gray-500">{$_('page.dashboard.noTrainingsToday')}</div>
  {:else}
    <ul class="list">
      {#each trainings as t (t.id)}
        <li>
          <span class="flex-auto">
            {t.title}
          </span>
          <span class="">
            <a
              class="btn btn-sm variant-filled-secondary"
              href="/dashboard/trainings/{t.id}/{date.format(dateFormat)}"
            >
              <Fa icon={faClipboardCheck} />
              <span>{$_('button.trackAttendance')}</span>
            </a>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<!-- Today's Events Section -->
<section>
  {#if todayEvents.length > 0}
    <ul class="list space-y-2">
      {#each todayEvents as event (event.id)}
        <li class="flex items-start">
          <div class="relative inline-block flex-none">
            <div
              class="w-12 h-12 bg-secondary-600 rounded-md flex items-center justify-center text-white"
            >
              <Fa icon={faCalendarDays} size="lg" />
            </div>
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
              <Fa icon={faClipboardCheck} />
              <span>{$_('button.trackAttendance')}</span>
            </a>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
