<script lang="ts">
  import type { Snippet } from 'svelte';

  // A part's title row, the same on the sheet, the program and the result:
  // title (may wrap) with its muted subtitle, points on the right.
  let {
    title,
    subtitle = '',
    heading = true,
    children
  }: {
    title: string;
    subtitle?: string;
    /** false inside a button, where a heading may not go */
    heading?: boolean;
    children?: Snippet;
  } = $props();
</script>

<svelte:element this={heading ? 'div' : 'span'} class="flex items-baseline gap-3">
  <svelte:element
    this={heading ? 'h3' : 'span'}
    class="block flex-1 min-w-0 text-base! font-semibold mb-0!"
  >
    {title}{#if subtitle}<span class="font-normal text-surface-600-400"
        >{` ·\u00a0${subtitle}`}</span
      >{/if}
  </svelte:element>
  {#if children}
    <span class="block flex-none text-right tabular-nums">{@render children()}</span>
  {/if}
</svelte:element>
