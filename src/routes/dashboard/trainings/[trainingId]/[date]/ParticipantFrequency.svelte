<script lang="ts">
  import { _ } from 'svelte-i18n';

  export let streak: boolean[];

  const RECENT_HALF = Math.ceil(streak.length / 2);

  $: recentCount = streak.slice(-RECENT_HALF).filter(Boolean).length;
  $: olderCount = streak.slice(0, RECENT_HALF).filter(Boolean).length;
  $: trend = recentCount > olderCount ? 'up' : recentCount < olderCount ? 'down' : 'stable';

  $: totalAttended = streak.filter(Boolean).length;
  $: tooltipText =
    totalAttended +
    '/' +
    streak.length +
    ' ' +
    $_('components.ParticipantFrequency.sessions') +
    (trend === 'up' ? ' \u2197' : trend === 'down' ? ' \u2198' : '');
</script>

{#if streak.length > 0}
  <div class="flex items-center gap-0.5" title={tooltipText} aria-label={tooltipText}>
    {#each streak as attended}
      <span
        class="inline-block w-1.5 h-1.5 rounded-full {attended
          ? 'bg-primary-500'
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
