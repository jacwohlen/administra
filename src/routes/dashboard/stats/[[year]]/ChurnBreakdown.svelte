<script lang="ts">
  let { year }: { year: number } = $props();

  import { supabaseClient } from '$lib/supabase';
  import { churnByAge, churnByTraining, type ChurnGroup, type RetentionRow } from '$lib/statsUtils';
  import { _, locale } from 'svelte-i18n';

  /**
   * Who left: members who trained the previous year but not this one, by
   * age group and by the training they attended most. Rates are relative to
   * everyone in that group who trained the previous year, so big groups
   * (kids) don't look worse just for being big.
   */
  const COLLAPSED = 6;
  let expanded = $state(false);

  async function load(y: number) {
    const { data, error } = await supabaseClient.rpc('get_retention_breakdown', {
      year_param: y.toString()
    });
    if (error) throw new Error(error.message);
    return (data as RetentionRow[]) ?? [];
  }

  let data = $derived(load(year));

  let percent = $derived(
    new Intl.NumberFormat($locale ?? 'de', { style: 'percent', maximumFractionDigits: 0 })
  );

  function ageLabel(key: string): string {
    if (key === 'unknown') return $_('page.stats.churn.ageUnknown');
    return $_('page.stats.churn.ageGroup', { values: { group: key.replace('-', '–') } });
  }

  function trainingLabel(rows: RetentionRow[], key: string) {
    const r = rows.find((row) => String(row.trainingId) === key)!;
    const day = r.weekday ? $_('weekdayShort.' + r.weekday) : '';
    const slot = [day, r.dateFrom?.slice(0, 5)].filter(Boolean).join(' ');
    return { title: r.title, sub: [slot, r.section].filter(Boolean).join(' · ') };
  }
</script>

{#snippet bar(g: ChurnGroup, title: string, sub?: string)}
  <li
    class="grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] sm:grid-cols-[minmax(0,1fr)_8rem_5rem] items-center gap-3 py-1.5"
    title={$_('page.stats.churn.ofActive', {
      values: { churned: g.churned, active: g.active }
    })}
  >
    <span class="min-w-0">
      <span class="block truncate text-sm">{title}</span>
      {#if sub}<span class="block truncate text-xs text-surface-600-400">{sub}</span>{/if}
    </span>
    <span class="h-3 rounded-sm bg-surface-200-800 overflow-hidden" aria-hidden="true">
      <span class="block h-full rounded-sm bg-error-500" style:width="{g.rate * 100}%"></span>
    </span>
    <span class="text-right tabular-nums leading-tight">
      <span class="block text-sm font-semibold">{percent.format(g.rate)}</span>
      <span class="block text-xs text-surface-600-400">{g.churned}/{g.active}</span>
    </span>
  </li>
{/snippet}

{#await data}
  <div class="grid gap-6 md:grid-cols-2">
    <div class="placeholder animate-pulse h-48"></div>
    <div class="placeholder animate-pulse h-48"></div>
  </div>
{:then rows}
  {@const byTraining = churnByTraining(rows)}
  {#if byTraining.length > 0}
    <div class="grid gap-6 md:grid-cols-2">
      <div class="min-w-0">
        <h3 class="text-sm! font-semibold text-surface-600-400 mb-1!">
          {$_('page.stats.churn.byAge')}
        </h3>
        <ol class="divide-y divide-surface-200-800">
          {#each churnByAge(rows) as g (g.key)}
            {@render bar(g, ageLabel(g.key))}
          {/each}
        </ol>
      </div>
      <div class="min-w-0">
        <h3 class="text-sm! font-semibold text-surface-600-400 mb-1!">
          {$_('page.stats.churn.byTraining')}
        </h3>
        <ol class="divide-y divide-surface-200-800">
          {#each expanded ? byTraining : byTraining.slice(0, COLLAPSED) as g (g.key)}
            {@const t = trainingLabel(rows, g.key)}
            {@render bar(g, t.title, t.sub)}
          {/each}
        </ol>
        {#if byTraining.length > COLLAPSED}
          <button
            class="btn btn-sm preset-tonal-surface w-full mt-2"
            onclick={() => (expanded = !expanded)}
          >
            {expanded
              ? $_('page.stats.showLess')
              : $_('page.stats.showAll', { values: { count: byTraining.length } })}
          </button>
        {/if}
      </div>
    </div>
  {:else}
    <p class="empty-state">{$_('page.stats.churn.none')}</p>
  {/if}
{:catch error}
  <p class="text-sm text-error-600-400">{error.message}</p>
{/await}
