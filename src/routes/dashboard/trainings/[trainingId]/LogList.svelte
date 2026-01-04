<script lang="ts">
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import { faGripLines, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  export let trainingId: string;

  interface LogSummary {
    trainingId: number;
    date: string;
    count: number;
    totalTrainerCount: number;
    hasLessonPlan: boolean;
  }

  async function getLogs() {
    const { error, data } = await supabaseClient
      .from('view_logs_summary')
      .select(`trainingId, date, count, totalTrainerCount, hasLessonPlan`)
      .eq('trainingId', trainingId)
      .order('date', { ascending: false })
      .returns<LogSummary[]>();

    if (error) {
      throw err(404, error);
    }
    return data;
  }
</script>

{#await getLogs() then logs}
  <ul class="list">
    {#each logs as i (i.date)}
      <li>
        <span>
          {i.date}
        </span>
        <span class="flex-auto">
          <div class="flex items-center gap-2">
            <span class="chip variant-filled-secondary">{i.count}</span>
            <span class="text-sm opacity-75">{$_('page.trainings.participants')}</span>
            {#if i.totalTrainerCount > 0}
              <span class="chip variant-filled-success">
                <img class="inline-block w-3" src="/judo-icon.svg" alt="trainer" />
                {i.totalTrainerCount}
              </span>
            {:else}
              <span class="chip variant-filled-warning">
                <Fa icon={faExclamationTriangle} class="w-3" />
                <span class="text-xs">{$_('page.trainings.noTrainer')}</span>
              </span>
            {/if}
            {#if !i.hasLessonPlan}
              <span class="chip variant-filled-warning">
                <Fa icon={faExclamationTriangle} class="w-3" />
                <span class="text-xs">{$_('page.trainings.noLessonPlan')}</span>
              </span>
            {/if}
          </div>
        </span>
        <span>
          <a
            class="btn btn-sm variant-filled-secondary"
            href="/dashboard/trainings/{trainingId}/{i.date}"
          >
            <Fa icon={faGripLines} />
            <span>{$_('button.view')}</span>
          </a>
        </span>
      </li>
    {/each}
  </ul>
{/await}
