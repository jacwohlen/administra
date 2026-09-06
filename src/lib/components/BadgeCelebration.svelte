<script lang="ts">
  import type { NewBadge } from '$lib/models';
  import { _ } from 'svelte-i18n';

  let { badges, memberName }: { badges: NewBadge[]; memberName: string } = $props();
  let visible = $state(true);

  function dismiss() {
    visible = false;
  }

  // Show on every new badge set and auto-dismiss after 6 seconds
  $effect(() => {
    if (badges.length > 0) {
      visible = true;
      const timeout = setTimeout(() => (visible = false), 6000);
      return () => clearTimeout(timeout);
    }
  });
</script>

{#if visible && badges.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay celebration-overlay"
    onclick={dismiss}
    onkeydown={(e) => {
      if (e.key === 'Escape') dismiss();
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="card modal-dialog text-center celebration-dialog"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="text-6xl leading-none mb-4 celebration-emoji">
        {#each badges as b}
          <span>{b.emoji}</span>
        {/each}
      </div>
      <h2 class="mb-1">{$_('badges.celebration.title')}</h2>
      <p class="font-bold mb-3">{memberName}</p>
      <div class="flex flex-wrap justify-center gap-2 mb-4">
        {#each badges as b}
          <span
            class="chip preset-tonal-primary"
            title={$_('badges.' + b.badgeId + '.description')}
          >
            <span>{b.emoji}</span>
            <span>{$_('badges.' + b.badgeId + '.name')}</span>
          </span>
        {/each}
      </div>
      <button class="btn preset-filled-primary-500 w-full" onclick={dismiss}>OK</button>
    </div>
  </div>
{/if}

<style>
  .celebration-overlay {
    animation: fadeIn 0.25s ease-out;
  }
  .celebration-dialog {
    animation: bounceIn 0.5s ease-out;
  }
  .celebration-emoji {
    animation: pop 0.8s ease-out;
  }
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes bounceIn {
    0% {
      opacity: 0;
      transform: scale(0.6);
    }
    70% {
      transform: scale(1.05);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
  @keyframes pop {
    0% {
      transform: scale(0.4) rotate(-15deg);
    }
    60% {
      transform: scale(1.25) rotate(8deg);
    }
    100% {
      transform: scale(1) rotate(0);
    }
  }
</style>
