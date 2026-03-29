<script lang="ts">
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import {
    faGripLines,
    faExclamationTriangle,
    faCalendarDays,
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
    <div class="card p-6 text-center">
      <p class="opacity-50">{$_('page.trainings.noLessonPlanMessage')}</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each logs as i (i.date)}
        <a
          href="/dashboard/trainings/{trainingId}/{i.date}"
          class="card p-3 flex items-center gap-3 hover:variant-soft-primary transition-colors"
        >
          <!-- Date -->
          <div class="text-center flex-none w-16">
            <p class="text-xs opacity-50 uppercase">{formatWeekday(i.date)}</p>
            <p class="font-bold text-sm">{formatDate(i.date)}</p>
          </div>

          <!-- Divider -->
          <div class="border-l border-surface-400/30 h-8 flex-none" />

          <!-- Stats -->
          <div class="flex items-center gap-2 flex-auto flex-wrap">
            <span class="chip variant-filled-secondary">
              {i.count}
              <span class="ml-1 text-xs">{$_('page.trainings.participants')}</span>
            </span>

            {#if i.totalTrainerCount > 0}
              <span class="chip variant-filled-success">
                <img class="inline-block w-3" src="/judo-icon.svg" alt="trainer" />
                <span class="ml-1">{i.totalTrainerCount}</span>
              </span>
            {:else}
              <span class="chip variant-filled-warning">
                <Fa icon={faExclamationTriangle} class="w-3" />
                <span class="ml-1 text-xs">{$_('page.trainings.noTrainer')}</span>
              </span>
            {/if}

            {#if i.hasLessonPlan}
              <span class="chip variant-soft-success">
                <Fa icon={faCheckCircle} size="xs" />
                <span class="ml-1 text-xs">{$_('page.trainings.hasLessonPlan')}</span>
              </span>
            {:else}
              <span class="chip variant-filled-warning">
                <Fa icon={faExclamationTriangle} class="w-3" />
                <span class="ml-1 text-xs">{$_('page.trainings.noLessonPlan')}</span>
              </span>
            {/if}
          </div>

          <!-- Arrow -->
          <div class="flex-none opacity-50">
            <Fa icon={faGripLines} />
          </div>
        </a>
      {/each}
    </div>
  {/if}
{/await}
