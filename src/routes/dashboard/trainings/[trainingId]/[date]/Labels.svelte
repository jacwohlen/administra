<script lang="ts">
  let { labels = [] }: { labels?: string[] } = $props();
</script>

{#each labels as l, i (l)}
  {#if i < 2}
    <span class="chip variant-ghost-secondary text-xs mr-1 px-1.5 py-0.5">{l}</span>
  {/if}
{/each}
{#if labels.length > 2}
  <span class="chip variant-ghost-surface text-xs px-1.5 py-0.5">+{labels.length - 2}</span>
{/if}
