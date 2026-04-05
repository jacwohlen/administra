<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { Log, Training } from '$lib/models';

  let { logs }: { logs: Promise<Log[]> } = $props();

  function countPerTraining(logs: Log[], id: string) {
    let total = 0;
    let mainTrainerCount = 0;
    logs.forEach((log) => {
      if (log.trainingId.id == id) {
        total++;
        if (log.trainerRole === 'main_trainer' || log.trainerRole === 'assistant') {
          mainTrainerCount++;
        }
      }
    });
    const attendanceCount = total - mainTrainerCount;
    return [attendanceCount, mainTrainerCount, total];
  }

  function getAttendedTrainings(logs: Log[]): Map<string, Training> {
    let attendedTrainings: Map<string, Training> = new Map();

    logs.forEach((log) => {
      attendedTrainings.set(log.trainingId.id, log.trainingId);
    });

    return attendedTrainings;
  }

  function computeTotals(logs: Log[]) {
    let total = 0;
    let trainerCount = 0;
    logs.forEach((log) => {
      total++;
      if (log.trainerRole === 'main_trainer' || log.trainerRole === 'assistant') {
        trainerCount++;
      }
    });
    return [total - trainerCount, trainerCount, total];
  }
</script>

<h3>{$_('page.members.trainingsSummary.title')}</h3>

<div class=" overflow-x-auto">
  <div class="min-w-[580px] pb-2 md:pb-0">
    {#await logs}
      <div class="space-y-4">
        <div class="placeholder" />
        <div class="grid grid-cols-3 gap-8">
          <div class="placeholder" />
          <div class="placeholder" />
          <div class="placeholder" />
        </div>
        <div class="grid grid-cols-4 gap-4">
          <div class="placeholder" />
          <div class="placeholder" />
          <div class="placeholder" />
          <div class="placeholder" />
        </div>
      </div>
    {:then l}
      <table class="table-auto w-full truncate">
        <thead>
          <tr>
            <th class="text-start">{$_('page.members.trainingsSummary.table.title')}</th>
            <th class="text-start">{$_('page.members.trainingsSummary.table.section')}</th>
            <th>{$_('page.members.trainingsSummary.table.attendance')}</th>
            <th>{$_('page.members.trainingsSummary.table.trainer')}</th>
            <th>{$_('page.members.trainingsSummary.table.total')}</th>
          </tr>
        </thead>
        <tbody>
          {#each getAttendedTrainings(l) as training}
            <tr>
              <td>{training[1].title + ' (' + $_('weekdayShort.' + training[1].weekday) + ')'}</td>
              <td>{training[1].section}</td>
              {#each countPerTraining(l, training[0]) as count}
                <td class="text-center">{count}</td>
              {/each}
            </tr>
          {:else}
            <span class="flex justify-center">
              {$_('page.members.trainingsSummary.noItems')}
            </span>
          {/each}
          <tr><td colspan="5"><hr class="my-2" /></td></tr>
          {#each [computeTotals(l)] as totals}
            <tr class="font-bold">
              <td>{$_('page.members.trainingsSummary.table.total')}</td>
              <td />
              <td class="text-center">{totals[0]}</td>
              <td class="text-center">{totals[1]}</td>
              <td class="text-center">{totals[2]}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:catch err}
      {err}
    {/await}
  </div>
</div>
