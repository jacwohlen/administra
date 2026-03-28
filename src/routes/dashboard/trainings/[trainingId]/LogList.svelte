<script lang="ts">
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import {
    faGripLines,
    faExclamationTriangle,
    faCheckCircle
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';

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

  function formatDate(date: string) {
    return dayjs(date).format('DD. MMM YYYY');
  }
</script>

{#await getLogs() then logs}
  <ul class="list">
    {#each logs as i (i.date)}
      <li class="rounded-lg">
        <span class="flex-shrink-0 w-28 text-sm font-medium">
          {formatDate(i.date)}
        </span>
        <span class="flex-auto">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="chip variant-filled-secondary">
              {i.count} {$_('page.trainings.participants')}
            </span>
            {#if i.totalTrainerCount > 0}
              <span class="chip variant-filled-success">
                <img class="inline-block w-3" src="/judo-icon.svg" alt="trainer" />
                <span>{i.totalTrainerCount}</span>
              </span>
            {:else}
              <span class="chip variant-filled-warning">
                <Fa icon={faExclamationTriangle} size="xs" />
                <span class="text-xs">{$_('page.trainings.noTrainer')}</span>
              </span>
            {/if}
            {#if i.hasLessonPlan}
              <span class="chip variant-soft-success">
                <Fa icon={faCheckCircle} size="xs" />
                <span class="text-xs">{$_('page.trainings.hasLessonPlan')}</span>
              </span>
            {:else}
              <span class="chip variant-filled-warning">
                <Fa icon={faExclamationTriangle} size="xs" />
                <span class="text-xs">{$_('page.trainings.noLessonPlan')}</span>
              </span>
            {/if}
          </div>
        </span>
        <span class="flex-shrink-0">
          <a
            class="btn btn-sm variant-ghost-primary"
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
