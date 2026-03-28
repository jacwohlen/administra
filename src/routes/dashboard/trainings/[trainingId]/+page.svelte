<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
  import LogList from './LogList.svelte';
  import utils from '$lib/utils';
  import Fa from 'svelte-fa';
  import { faUsers, faCalendarDay, faClipboardCheck } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';

  function getDateString() {
    const weekday = utils.weekdayToNumber(data.weekday);
    return utils.getMostRecentDateByWeekday(weekday).format('YYYY-MM-DD');
  }
</script>

<!-- Header card -->
<div class="card p-5 mb-4">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h2 class="h2">{data.title}</h2>
      <div class="flex items-center gap-2 mt-2 flex-wrap">
        <span class="badge variant-filled-secondary">{data.section}</span>
        <span class="badge variant-soft-surface">{$_('weekday.' + data.weekday)}</span>
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

<!-- Info cards row -->
<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
  <div class="card p-4 text-center">
    <div class="flex flex-col items-center gap-1">
      <Fa icon={faUsers} class="text-lg opacity-60" />
      <span class="text-2xl font-bold">{data.participants.length}</span>
      <span class="text-sm opacity-60">{$_('page.trainings.participants')}</span>
    </div>
  </div>
  <div class="card p-4 text-center">
    <div class="flex flex-col items-center gap-1">
      <Fa icon={faCalendarDay} class="text-lg opacity-60" />
      <span class="text-2xl font-bold">{data.dateFrom}</span>
      <span class="text-sm opacity-60">{$_('page.trainings.dateFrom')}</span>
    </div>
  </div>
  <div class="card p-4 text-center">
    <div class="flex flex-col items-center gap-1">
      <Fa icon={faCalendarDay} class="text-lg opacity-60" />
      <span class="text-2xl font-bold">{data.dateTo}</span>
      <span class="text-sm opacity-60">{$_('page.trainings.dateTo')}</span>
    </div>
  </div>
</div>

<!-- Session log -->
<div class="card p-4">
  <h3 class="h3 mb-3">{$_('page.trainings.logs')}</h3>
  <LogList trainingId={data.id} />
</div>
