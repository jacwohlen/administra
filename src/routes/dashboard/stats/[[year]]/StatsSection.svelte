<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A stats card: title, an optional hint below it, actions on the right. */
  let {
    title,
    hint,
    actions,
    children,
    class: className = ''
  }: {
    title: string;
    hint?: string;
    actions?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();
</script>

<section class="card border border-surface-200-800 p-4 min-w-0 {className}">
  <header class="flex items-start justify-between gap-3 mb-3">
    <div class="min-w-0">
      <h2 class="text-base! font-semibold mb-0!">{title}</h2>
      {#if hint}
        <p class="text-xs text-surface-600-400">{hint}</p>
      {/if}
    </div>
    {#if actions}
      <div class="flex-none flex items-center gap-2">{@render actions()}</div>
    {/if}
  </header>
  {@render children()}
</section>
