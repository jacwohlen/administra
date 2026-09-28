<script lang="ts" module>
  export interface GroupBar {
    key: string;
    title: string;
    sub?: string;
    /** Bar length, 0..1 */
    fill: number;
    value: string;
    detail: string;
  }
</script>

<script lang="ts">
  import { _ } from 'svelte-i18n';

  /** A titled list of horizontal bars with a value and a small detail line. */
  let {
    title,
    items,
    tone,
    limit = Infinity
  }: { title: string; items: GroupBar[]; tone: 'error' | 'success'; limit?: number } = $props();

  let expanded = $state(false);
</script>

<div class="min-w-0">
  <h3 class="text-sm! font-semibold text-surface-600-400 mb-1!">{title}</h3>
  <ol class="divide-y divide-surface-200-800">
    {#each expanded ? items : items.slice(0, limit) as item (item.key)}
      <li
        class="grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] sm:grid-cols-[minmax(0,1fr)_8rem_5rem] items-center gap-3 py-1.5"
      >
        <span class="min-w-0">
          <span class="block truncate text-sm">{item.title}</span>
          {#if item.sub}
            <span class="block truncate text-xs text-surface-600-400">{item.sub}</span>
          {/if}
        </span>
        <span class="h-3 rounded-sm bg-surface-200-800 overflow-hidden" aria-hidden="true">
          <span
            class="block h-full rounded-sm {tone === 'error' ? 'bg-error-500' : 'bg-success-500'}"
            style:width="{item.fill * 100}%"
          ></span>
        </span>
        <span class="text-right tabular-nums leading-tight">
          <span class="block text-sm font-semibold">{item.value}</span>
          <span class="block text-xs text-surface-600-400">{item.detail}</span>
        </span>
      </li>
    {/each}
  </ol>
  {#if items.length > limit}
    <button
      class="btn btn-sm preset-tonal-surface w-full mt-2"
      onclick={() => (expanded = !expanded)}
    >
      {expanded
        ? $_('page.stats.showLess')
        : $_('page.stats.showAll', { values: { count: items.length } })}
    </button>
  {/if}
</div>
