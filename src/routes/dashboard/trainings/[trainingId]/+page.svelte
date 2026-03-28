<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
  import LogList from './LogList.svelte';
  import utils from '$lib/utils';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faCalendarCheck,
    faUsers,
    faClipboardCheck,
    faLayerGroup
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';

  function getDateString() {
    const weekday = utils.weekdayToNumber(data.weekday);
    return utils.getMostRecentDateByWeekday(weekday).format('YYYY-MM-DD');
  }

  function formatDate(date: string) {
    return dayjs(date).format('DD.MM.YYYY');
  }
</script>

<!-- Header -->
<div class="card p-4 mb-6">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div>
      <h2 class="h2">{data.title}</h2>
      <div class="flex items-center gap-2 mt-1">
        <span class="badge variant-filled-secondary">{data.section}</span>
        <span class="text-sm opacity-70">{$_('weekday.' + data.weekday)}</span>
      </div>
    </div>
    <a
      class="btn variant-filled-primary"
      href="/dashboard/trainings/{data.id}/{getDateString()}"
    >
      <Fa icon={faClipboardCheck} />
      <span>{$_('button.trackAttendance')}</span>
    </a>
  </div>
</div>

<!-- Info cards -->
<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
  <div class="card p-3 text-center">
    <Fa icon={faUsers} class="text-primary-500 mb-1" size="lg" />
    <p class="text-2xl font-bold">{data.participants.length}</p>
    <p class="text-xs opacity-70">{$_('page.trainings.participants')}</p>
  </div>
  <div class="card p-3 text-center">
    <Fa icon={faLayerGroup} class="text-secondary-500 mb-1" size="lg" />
    <p class="text-sm font-bold mt-1">{data.section}</p>
    <p class="text-xs opacity-70">{$_('page.trainings.section')}</p>
  </div>
  <div class="card p-3 text-center">
    <Fa icon={faCalendarDays} class="text-tertiary-500 mb-1" size="lg" />
    <p class="text-sm font-bold mt-1">{formatDate(data.dateFrom)}</p>
    <p class="text-xs opacity-70">{$_('page.trainings.dateFrom')}</p>
  </div>
  <div class="card p-3 text-center">
    <Fa icon={faCalendarCheck} class="text-tertiary-500 mb-1" size="lg" />
    <p class="text-sm font-bold mt-1">{formatDate(data.dateTo)}</p>
    <p class="text-xs opacity-70">{$_('page.trainings.dateTo')}</p>
  </div>
</div>

<!-- Logs section -->
<div class="flex items-center justify-between mb-3">
  <h3 class="h3">{$_('page.trainings.logs')}</h3>
</div>
<LogList trainingId={data.id} />
