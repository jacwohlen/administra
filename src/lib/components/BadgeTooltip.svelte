<script lang="ts">
  import { badgeTip, dismissTip } from '$lib/badgeTip.svelte';
  import { _ } from 'svelte-i18n';

  function onWindowClick(e: MouseEvent) {
    if (badgeTip.pinned && !(e.target as HTMLElement).closest('[data-badge-tip]')) dismissTip();
  }
</script>

<svelte:window onclick={onWindowClick} onscrollcapture={dismissTip} onresize={dismissTip} />

{#if badgeTip.tip}
  {@const tip = badgeTip.tip}
  <div
    class="tip"
    class:below={tip.below}
    role="tooltip"
    style:left="{tip.x}px"
    style:top="{tip.y}px"
    data-badge-tip
  >
    <span class="font-semibold">{$_('badges.' + tip.badgeId + '.name')}</span>
    <span class="tip-text">
      {$_('badges.' + tip.badgeId + '.description')}{#if tip.current !== undefined && tip.threshold}
        · {tip.current} {$_('badges.progress.of')} {tip.threshold}{/if}
    </span>
  </div>
{/if}

<style>
  /* Dark on light and light on dark, centred on the badge */
  .tip {
    position: fixed;
    z-index: 60;
    transform: translate(-50%, -100%);
    max-width: 16rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-container, 0.75rem);
    background: var(--color-surface-950-50);
    color: var(--color-surface-50-950);
    font-size: 0.8rem;
    line-height: 1.35;
    box-shadow: 0 10px 25px -5px rgb(0 0 0 / 0.3);
    pointer-events: none;
  }
  .tip.below {
    transform: translate(-50%, 0);
  }
  .tip-text {
    display: block;
    opacity: 0.85;
  }
</style>
