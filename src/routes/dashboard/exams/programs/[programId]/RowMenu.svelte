<script lang="ts">
  import Fa from 'svelte-fa';
  import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

  // The ⋮ menu of an editor row (move up / down, remove), opened like the
  // check-in's participant menu so a row keeps one compact button.
  interface Action {
    label: string;
    icon: IconDefinition;
    onclick: () => void;
    disabled?: boolean;
    danger?: boolean;
  }

  let { label, actions }: { label: string; actions: Action[] } = $props();

  let open = $state(false);
  let style = $state('');
  let btnEl = $state<HTMLButtonElement>();

  function toggle() {
    if (open || !btnEl) {
      open = false;
      return;
    }
    const rect = btnEl.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom > 200;
    // Right-aligned with the button, below it unless the screen ends there
    const right = window.innerWidth - rect.right;
    style = below
      ? `position:fixed;top:${rect.bottom + 4}px;right:${right}px;z-index:9999;`
      : `position:fixed;bottom:${window.innerHeight - rect.top + 4}px;right:${right}px;z-index:9999;`;
    open = true;
  }

  function onWindowClick(e: MouseEvent) {
    if (open && btnEl && !btnEl.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onscrollcapture={() => (open = false)} />

<div class="flex-none">
  <button
    type="button"
    class="btn preset-tonal-surface"
    bind:this={btnEl}
    title={label}
    aria-label={label}
    aria-expanded={open}
    onclick={toggle}
  >
    <Fa icon={faEllipsisVertical} />
  </button>
  {#if open}
    <nav
      class="card min-w-48 p-1 shadow-xl bg-surface-50-950 border border-surface-300-700"
      {style}
    >
      {#each actions as a (a.label)}
        <button
          type="button"
          class="btn w-full justify-start {a.danger ? 'text-error-600-400' : ''}"
          disabled={a.disabled}
          onclick={() => {
            open = false;
            a.onclick();
          }}
        >
          <Fa icon={a.icon} />
          <span>{a.label}</span>
        </button>
      {/each}
    </nav>
  {/if}
</div>
