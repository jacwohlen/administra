<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  import LogList from './LogList.svelte';
  import utils from '$lib/utils';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faClock, faUsers, faClipboardCheck } from '@fortawesome/free-solid-svg-icons';

  function getDateString() {
    const weekday = utils.weekdayToNumber(data.weekday);
    return utils.getMostRecentDateByWeekday(weekday).format('YYYY-MM-DD');
  }
</script>

<!-- Header -->
<div class="card p-4 mb-6">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div>
      <h2 class="h2">{data.title}</h2>
      <div class="flex items-center gap-2 mt-2 flex-wrap">
        <span class="badge variant-filled-secondary">{data.section}</span>
        <span class="badge variant-soft-surface">{$_('weekday.' + data.weekday)}</span>
        <span class="badge variant-soft-surface">
          <Fa icon={faClock} size="xs" class="mr-1" />
          {data.dateFrom} – {data.dateTo}
        </span>
        <span class="badge variant-soft-surface">
          <Fa icon={faUsers} size="xs" class="mr-1" />
          {data.participants.length}
          {$_('page.trainings.participants')}
        </span>
      </div>
    </div>
    <a
      class="btn variant-filled-primary flex-none"
      href="/dashboard/trainings/{data.id}/{getDateString()}"
    >
      <Fa icon={faClipboardCheck} />
      <span>{$_('button.trackAttendance')}</span>
    </a>
  </div>
</div>

<!-- Logs section -->
<div class="flex items-center justify-between mb-3">
  <h3 class="h3">{$_('page.trainings.logs')}</h3>
</div>
<LogList trainingId={data.id} />
