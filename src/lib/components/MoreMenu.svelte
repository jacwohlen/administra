<script lang="ts">
  import type { Snippet } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';

  /**
   * The ⋮ button on detail pages with the less common actions (delete,
   * archive …) in a dropdown, so they can't be hit by accident. The menu is
   * fixed-positioned so it isn't clipped by the header; a click elsewhere or
   * Escape closes it. Items get `close` to call before their action.
   */
  let { items }: { items: Snippet<[close: () => void]> } = $props();

  let open = $state(false);
  let style = $state('');
  let buttonEl = $state<HTMLButtonElement>();

  function close() {
    open = false;
  }

  function toggle() {
    if (open || !buttonEl) {
      open = false;
      return;
    }
    const rect = buttonEl.getBoundingClientRect();
    style = `position:fixed;top:${rect.bottom + 4}px;left:${rect.right - 192}px;z-index:9999;`;
    open = true;
  }
</script>

<svelte:window
  onclick={(e) => {
    if (open && buttonEl && !buttonEl.contains(e.target as Node)) open = false;
  }}
  onkeydown={(e) => {
    if (open && e.key === 'Escape') open = false;
  }}
/>

<div class="relative">
  <button
    type="button"
    class="btn preset-tonal-surface"
    bind:this={buttonEl}
    onclick={toggle}
    title={$_('page.members.moreActions')}
    aria-label={$_('page.members.moreActions')}
    aria-expanded={open}
  >
    <Fa icon={faEllipsisVertical} />
  </button>
  {#if open}
    <nav
      class="card min-w-48 p-1 shadow-xl bg-surface-50-950 border border-surface-300-700"
      {style}
    >
      {@render items(close)}
    </nav>
  {/if}
</div>
