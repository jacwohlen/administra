<script lang="ts">
  import type { NewBadge } from '$lib/models';
  import { _ } from 'svelte-i18n';

  let { badges, memberName }: { badges: NewBadge[]; memberName: string } = $props();
  let visible = $state(true);

  function dismiss() {
    visible = false;
  }

  // Auto-dismiss after 5 seconds
  $effect(() => {
    if (badges.length > 0) {
      visible = true;
      const timeout = setTimeout(() => (visible = false), 5000);
      return () => clearTimeout(timeout);
    }
  });
</script>

{#if visible && badges.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
    onclick={dismiss}
    onkeydown={(e) => {
      if (e.key === 'Escape') dismiss();
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="card p-6 text-center shadow-2xl max-w-sm mx-4 animate-bounce-in"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="text-5xl mb-3 animate-pulse">
        {#each badges as b}
          {b.emoji}
        {/each}
      </div>
      <h2 class="text-xl font-bold mb-2">{$_('badges.celebration.title')}</h2>
      {#each badges as b}
        <p class="text-surface-600-400">
          {memberName} — {$_('badges.' + b.badgeId + '.name')}
        </p>
      {/each}
      <button class="btn preset-tonal-primary mt-4" onclick={dismiss}>OK</button>
    </div>
  </div>
{/if}

<style>
  .animate-fade-in {
    animation: fadeIn 0.3s ease-out;
  }
  .animate-bounce-in {
    animation: bounceIn 0.5s ease-out;
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
      transform: scale(0.5);
    }
    70% {
      transform: scale(1.05);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
