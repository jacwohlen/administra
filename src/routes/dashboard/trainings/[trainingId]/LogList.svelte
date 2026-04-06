<script lang="ts">
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import {
    faExclamationTriangle,
    faCheckCircle,
    faGripLines
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';

  let { trainingId }: { trainingId: string } = $props();

  interface LogSummary {
    trainingId: number;
    date: string;
    count: number;
    totalTrainerCount: number;
    hasLessonPlan: boolean;
  }

  function formatDate(date: string) {
    return dayjs(date).format('DD.MM.YYYY');
  }

  function formatWeekday(date: string) {
    return dayjs(date).format('ddd');
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
  {#if logs.length === 0}
    <p class="text-center text-surface-600-400 py-4">{$_('page.trainings.noLessonPlanMessage')}</p>
  {:else}
    <div class="flex flex-col gap-1">
      {#each logs as i (i.date)}
        <a
          href="/dashboard/trainings/{trainingId}/{i.date}"
          class="flex items-center gap-3 py-2 hover:bg-surface-100-900 rounded px-2 -mx-2 transition-colors"
        >
          <div class="text-center flex-none w-20">
            <p class="text-xs text-surface-600-400 uppercase">{formatWeekday(i.date)}</p>
            <p class="font-bold text-sm">{formatDate(i.date)}</p>
          </div>

          <div class="flex items-center gap-1.5 flex-auto flex-wrap">
            <span class="chip preset-tonal-secondary text-xs">
              {i.count}
              {$_('page.trainings.participants')}
            </span>

            {#if i.totalTrainerCount > 0}
              <span class="chip preset-tonal-success text-xs">
                <img class="inline-block w-3" src="/judo-icon.svg" alt="trainer" />
                <span class="ml-0.5">{i.totalTrainerCount}</span>
              </span>
            {:else}
              <span class="chip preset-tonal-warning text-xs">
                <Fa icon={faExclamationTriangle} size="xs" />
                <span class="ml-0.5">{$_('page.trainings.noTrainer')}</span>
              </span>
            {/if}

            {#if i.hasLessonPlan}
              <span class="chip preset-tonal-success text-xs">
                <Fa icon={faCheckCircle} size="xs" />
              </span>
            {:else}
              <span class="chip preset-tonal-warning text-xs">
                <Fa icon={faExclamationTriangle} size="xs" />
                <span class="ml-0.5">{$_('page.trainings.noLessonPlan')}</span>
              </span>
            {/if}
          </div>

          <span class="btn preset-tonal-primary flex-shrink-0">
            <Fa icon={faGripLines} />
            <span>{$_('button.view')}</span>
          </span>
        </a>
      {/each}
    </div>
  {/if}
{/await}
