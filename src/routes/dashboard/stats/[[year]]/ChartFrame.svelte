<script lang="ts">
  import '@carbon/charts/styles.css';
  import type { Snippet } from 'svelte';

  /**
   * Hosts a Carbon chart so it blends into the app: transparent background,
   * the app's font and text colors, and the Carbon theme that matches the
   * current light/dark mode. The chart is re-created when the mode is
   * toggled, because Carbon only reads its theme on mount.
   */
  let { height = 300, children }: { height?: number; children: Snippet<[boolean]> } = $props();

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
  {#key dark}
    {@render children(dark)}
  {/key}
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
