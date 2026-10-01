<script lang="ts">
  import type { Snippet } from 'svelte';
  import { loadCharts, type Charts } from './charts';

  /**
   * Hosts a Carbon chart so it blends into the app: transparent background,
   * the app's font and text colors, and the Carbon theme that matches the
   * current light/dark mode. The chart is re-created when the mode is
   * toggled, because Carbon only reads its theme on mount.
   *
   * Carbon (JS and CSS) is loaded on demand, so the rest of the stats page
   * shows up without waiting for it; the children get the loaded module.
   */
  let { height = 300, children }: { height?: number; children: Snippet<[boolean, Charts]> } =
    $props();

  const charts = loadCharts();

  let dark = $state(false);

  $effect(() => {
    const root = document.documentElement;
    const update = () => (dark = root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  });
</script>

<div class="stats-chart" style:min-height="{height}px">
  {#await charts}
    <div class="placeholder animate-pulse w-full" style:height="{height}px"></div>
  {:then lib}
    {#key dark}
      {@render children(dark, lib)}
    {/key}
  {/await}
</div>

<style>
  .stats-chart :global(.cds--chart-holder[data-carbon-theme]) {
    --cds-background: transparent;
    --cds-grid-bg: transparent;
    --cds-text-primary: var(--color-surface-950-50);
    --cds-text-secondary: var(--color-surface-600-400);
    --cds-border-subtle-00: var(--color-surface-200-800);
    --cds-border-subtle-01: var(--color-surface-200-800);
    --cds-border-strong-01: var(--color-surface-300-700);
    --cds-charts-font-family: inherit;
    --cds-charts-font-family-condensed: inherit;
    font-family: inherit;
  }

  .stats-chart :global(.cds--cc--axes g.axis .tick text) {
    fill: var(--color-surface-600-400);
  }
</style>
