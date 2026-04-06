<script lang="ts">
  import { _ } from 'svelte-i18n';

  /** Historical attendance for last N sessions (oldest first). */
  let { streak, isPresent }: { streak: boolean[]; isPresent: boolean } = $props();

  let fullStreak = $derived([...streak, isPresent]);

  let recentHalf = $derived(Math.ceil(fullStreak.length / 2));
  let recentCount = $derived(fullStreak.slice(-recentHalf).filter(Boolean).length);
  let olderCount = $derived(fullStreak.slice(0, recentHalf).filter(Boolean).length);
  let trend = $derived(
    recentCount > olderCount ? 'up' : recentCount < olderCount ? 'down' : 'stable'
  );

  let totalAttended = $derived(fullStreak.filter(Boolean).length);
  let tooltipText = $derived(
    totalAttended +
      '/' +
      fullStreak.length +
      ' ' +
      $_('components.ParticipantFrequency.sessions') +
      (trend === 'up' ? ' \u2197' : trend === 'down' ? ' \u2198' : '')
  );
</script>

{#if fullStreak.length > 0}
  <div class="flex items-center gap-0.5" title={tooltipText} aria-label={tooltipText}>
    {#each fullStreak as attended, i}
      {@const isCurrent = i === fullStreak.length - 1}
      <span
        class="inline-block rounded-full {isCurrent ? 'w-2.5 h-2.5' : 'w-2 h-2'}
          {attended
          ? isCurrent
            ? 'bg-primary-600-400 ring-1 ring-primary-300-700'
            : 'bg-primary-600-400'
          : isCurrent
            ? 'bg-surface-300-700 ring-1 ring-surface-400-600'
            : 'bg-surface-300-700'}"
      />
    {/each}
    <span
      class="ml-1 text-xs leading-none {trend === 'up'
        ? 'text-success-600-400'
        : trend === 'down'
          ? 'text-error-600-400'
          : 'text-surface-400-600'}"
    >
      {#if trend === 'up'}&#8599;{:else if trend === 'down'}&#8600;{:else}&middot;{/if}
    </span>
  </div>
{/if}
