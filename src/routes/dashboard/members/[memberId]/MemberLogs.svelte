<script lang="ts">
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import { faArrowRight, faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import type { Log } from '$lib/models';
  import AttendanceGraph from './AttendanceGraph.svelte';
  import AttendanceLog from './AttendanceLog.svelte';
  import AttendanceSummary from './AttendanceSummary.svelte';

  export let memberId: string;

  async function getLogs() {
    // Fetch logs
    const { error, data } = await supabaseClient
      .from('logs')
      .select('date, trainingId ( id, title, section, weekday ), trainerRole')
      .eq('memberId', memberId)
      .gte('date', year + '-01-01')
      .lte('date', year + '-12-31')
      .order('date', { ascending: false })
      .returns<Log[]>();

    if (error) {
      throw err(404, error);
    }

    return data;
  }

  async function previousYear() {
    year = year - 1;
    l = getLogs();
  }

  async function nextYear() {
    year = year + 1;
    l = getLogs();
  }

  $: year = new Date().getFullYear();
  $: l = getLogs();
</script>

<div class="flex justify-between items-center m-2">
  <div>
    <button class="btn" on:click={previousYear}>
      <Fa icon={faArrowLeft} /><span>{$_('button.year')}</span>
    </button>
  </div>
  <div>
    {year}
  </div>
  <div>
    <button class="btn" on:click={nextYear}>
      <span>{$_('button.year')}</span><Fa icon={faArrowRight} />
    </button>
  </div>
</div>
<div class="card p-4">
  <AttendanceGraph logs={l} {year} />
</div>
<div class="card p-4">
  <AttendanceSummary logs={l} />
</div>
<div class="card p-4">
  <AttendanceLog logs={l} />
</div>
