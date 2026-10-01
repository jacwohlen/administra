<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { Log } from '$lib/models';
  import { attendanceByTraining } from '$lib/activityUtils';

  // Per training of the selected year: one bar each, split into attendance
  // and trainer sessions. The year totals are the stat tiles above.
  let { logs }: { logs: Promise<Log[]> } = $props();
</script>

<h3>{$_('page.members.trainingsSummary.title')}</h3>
{#await logs}
  <div class="space-y-3">
    {#each [0, 1, 2] as i (i)}
      <div class="placeholder h-9 animate-pulse"></div>
    {/each}
  </div>
{:then l}
  {@const rows = attendanceByTraining(l)}
  {@const max = Math.max(1, ...rows.map((r) => r.total))}
  {#if rows.length === 0}
    <p class="text-center text-surface-600-400 py-4">
      {$_('page.members.trainingsSummary.noItems')}
    </p>
  {:else}
    {#if rows.some((r) => r.asTrainer > 0)}
      <div class="flex gap-4 text-xs text-surface-600-400 mb-3">
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2.5 rounded-[2px] bg-primary-500"></span>
          {$_('page.members.attendance.attended')}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2.5 rounded-[2px] bg-primary-300-700"></span>
          {$_('page.members.attendance.asTrainer')}
        </span>
      </div>
    {/if}
    <ul class="space-y-3">
      {#each rows as row (row.id)}
        <li class="space-y-1">
          <div class="flex items-baseline justify-between gap-3">
            <div class="min-w-0 truncate">
              <span class="font-semibold">{row.title}</span>
              <span class="text-sm text-surface-600-400">
                {$_('weekdayShort.' + row.weekday)} · {row.section}
              </span>
            </div>
            <span
              class="flex-none tabular-nums font-semibold"
              title={$_('page.members.attendance.total')}
            >
              {row.total}
            </span>
          </div>
          <div
            class="flex h-2 rounded-full bg-surface-200-800 overflow-hidden"
            role="img"
            aria-label="{$_('page.members.attendance.attended')}: {row.attended}, {$_(
              'page.members.attendance.asTrainer'
            )}: {row.asTrainer}"
          >
            <span class="bg-primary-500" style:width="{(row.attended / max) * 100}%"></span>
            <span class="bg-primary-300-700" style:width="{(row.asTrainer / max) * 100}%"></span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
{:catch err}
  {err}
{/await}
