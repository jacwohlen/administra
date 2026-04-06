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
<div class="flex items-center justify-between mb-4">
  <h1>{data.title}</h1>
  <a
    class="btn btn-sm min-h-[44px] preset-tonal-primary flex-none"
    href="/dashboard/trainings/{data.id}/{getDateString()}"
  >
    <Fa icon={faClipboardCheck} />
    <span class="hidden sm:inline">{$_('button.trackAttendance')}</span>
  </a>
</div>
<div class="flex items-center gap-2 mb-6 flex-wrap text-sm">
  <span class="chip preset-tonal-secondary">{data.section}</span>
  <span class="text-surface-600-400">{$_('weekday.' + data.weekday)}</span>
  <span class="text-surface-600-400">
    <Fa icon={faClock} size="xs" class="inline mr-1" />{data.dateFrom} – {data.dateTo}
  </span>
  <span class="text-surface-600-400">
    <Fa icon={faUsers} size="xs" class="inline mr-1" />{data.participants.length}
    {$_('page.trainings.participants')}
  </span>
</div>

<!-- Logs section -->
<h3 class="text-lg font-semibold mb-3">{$_('page.trainings.logs')}</h3>
<LogList trainingId={data.id} />
