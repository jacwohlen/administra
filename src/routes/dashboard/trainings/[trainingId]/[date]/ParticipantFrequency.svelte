<script lang="ts">
  import { _ } from 'svelte-i18n';

  /** Historical attendance for last N sessions (oldest first). */
  export let streak: boolean[];
  /** Whether the participant is checked as present for the current session. */
  export let isPresent: boolean;

  $: fullStreak = [...streak, isPresent];

  $: recentHalf = Math.ceil(fullStreak.length / 2);
  $: recentCount = fullStreak.slice(-recentHalf).filter(Boolean).length;
  $: olderCount = fullStreak.slice(0, recentHalf).filter(Boolean).length;
  $: trend = recentCount > olderCount ? 'up' : recentCount < olderCount ? 'down' : 'stable';

  $: totalAttended = fullStreak.filter(Boolean).length;
  $: tooltipText =
    totalAttended +
    '/' +
    fullStreak.length +
    ' ' +
    $_('components.ParticipantFrequency.sessions') +
    (trend === 'up' ? ' \u2197' : trend === 'down' ? ' \u2198' : '');
</script>

{#if fullStreak.length > 0}
  <div class="flex items-center gap-0.5" title={tooltipText} aria-label={tooltipText}>
    {#each fullStreak as attended, i}
      {@const isCurrent = i === fullStreak.length - 1}
      <span
        class="inline-block rounded-full {isCurrent ? 'w-2 h-2' : 'w-1.5 h-1.5'}
          {attended
          ? isCurrent
            ? 'bg-primary-500 ring-1 ring-primary-300 dark:ring-primary-700'
            : 'bg-primary-500'
          : isCurrent
          ? 'bg-surface-300 dark:bg-surface-600 ring-1 ring-surface-400 dark:ring-surface-500'
          : 'bg-surface-300 dark:bg-surface-600'}"
      />
    {/each}
    <span
      class="ml-1 text-xs leading-none {trend === 'up'
        ? 'text-success-600 dark:text-success-400'
        : trend === 'down'
        ? 'text-error-500 dark:text-error-400'
        : 'text-surface-400'}"
    >
      {#if trend === 'up'}&#8599;{:else if trend === 'down'}&#8600;{:else}&middot;{/if}
    </span>
  </div>
{/if}
