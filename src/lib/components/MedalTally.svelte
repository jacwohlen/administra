<script lang="ts">
  import type { MedalTally } from '$lib/gradeUtils';

  let { tally, compact = false }: { tally: MedalTally; compact?: boolean } = $props();
</script>

{#if compact}
  {#if tally.total > 0}
    <span class="inline-flex items-center gap-1.5 text-xs tabular-nums whitespace-nowrap">
      {#if tally.gold}<span>🥇{tally.gold}</span>{/if}
      {#if tally.silver}<span>🥈{tally.silver}</span>{/if}
      {#if tally.bronze}<span>🥉{tally.bronze}</span>{/if}
    </span>
  {/if}
{:else}
  <div class="flex gap-1.5 tabular-nums">
    <span class="chip bg-surface-100-900 text-sm" class:opacity-50={!tally.gold}
      >🥇 {tally.gold}</span
    >
    <span class="chip bg-surface-100-900 text-sm" class:opacity-50={!tally.silver}>
      🥈 {tally.silver}
    </span>
    <span class="chip bg-surface-100-900 text-sm" class:opacity-50={!tally.bronze}>
      🥉 {tally.bronze}
    </span>
  </div>
{/if}
