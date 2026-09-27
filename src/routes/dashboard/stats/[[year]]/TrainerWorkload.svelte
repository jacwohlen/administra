<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  interface TrainerData {
    memberId: number;
    lastname: string;
    firstname: string;
    main_trainer_count: number;
    assistant_count: number;
    total_count: number;
  }

  const COLLAPSED = 10;
  let expanded = $state(false);

  async function loadData(mode: 'ALL' | 'YEAR', y: number) {
    const yearParam = mode === 'ALL' ? '' : y.toString();
    const { data } = await supabaseClient.rpc('get_trainer_workload', {
      year_param: yearParam
    });
    return [...((data as TrainerData[]) ?? [])].sort((a, b) => b.total_count - a.total_count);
  }

  let data = $derived(loadData(yearmode, year));
</script>

{#await data}
  <div class="space-y-3">
    {#each { length: 5 }, i (i)}
      <div class="placeholder animate-pulse h-5"></div>
    {/each}
  </div>
{:then trainers}
  {#if trainers.length > 0}
    {@const max = trainers[0].total_count || 1}
    <div class="flex gap-4 text-xs text-surface-600-400 mb-3">
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm bg-primary-500"></span>{$_('page.stats.mainTrainer')}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm bg-primary-300"></span>{$_('page.stats.assistant')}
      </span>
    </div>
    <ol class="space-y-1">
      {#each expanded ? trainers : trainers.slice(0, COLLAPSED) as t (t.memberId)}
        <li>
          <a
            href="/dashboard/members/{t.memberId}"
            class="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] sm:grid-cols-[minmax(0,12rem)_1fr_3rem] items-center gap-3 py-1 rounded hover:bg-surface-100-900"
            title="{$_('page.stats.mainTrainer')}: {t.main_trainer_count} · {$_(
              'page.stats.assistant'
            )}: {t.assistant_count}"
          >
            <span class="truncate text-sm">{t.firstname} {t.lastname}</span>
            <span class="flex h-3 gap-0.5" aria-hidden="true">
              {#if t.main_trainer_count > 0}
                <span
                  class="rounded-sm bg-primary-500"
                  style:width="{(t.main_trainer_count / max) * 100}%"
                ></span>
              {/if}
              {#if t.assistant_count > 0}
                <span
                  class="rounded-sm bg-primary-300"
                  style:width="{(t.assistant_count / max) * 100}%"
                ></span>
              {/if}
            </span>
            <span class="text-sm font-semibold tabular-nums text-right">{t.total_count}</span>
          </a>
        </li>
      {/each}
    </ol>
    {#if trainers.length > COLLAPSED}
      <button
        class="btn btn-sm preset-tonal-surface w-full mt-3"
        onclick={() => (expanded = !expanded)}
      >
        {expanded
          ? $_('page.stats.showLess')
          : $_('page.stats.showAll', { values: { count: trainers.length } })}
      </button>
    {/if}
  {:else}
    <p class="empty-state">{$_('page.stats.no_data')}</p>
  {/if}
{/await}
