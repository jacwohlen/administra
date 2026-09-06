<script lang="ts">
  import type { Badge, BadgeDefinition, BadgeProgress } from '$lib/models';
  import {
    badgeKey,
    badgeSuffix,
    buildBadgeTrails,
    groupBadgesWithProgress,
    progressPercent,
    TRAIL_CATEGORIES,
    type BadgeCategoryGroup
  } from '$lib/badgeUtils';
  import { _ } from 'svelte-i18n';

  let {
    badges,
    progress = [],
    definitions = []
  }: { badges: Badge[]; progress?: BadgeProgress[]; definitions?: BadgeDefinition[] } = $props();

  // Ladder categories are drawn as trails when the definitions are known;
  // without them (fetch failed) every category falls back to chips.
  let hasTrails = $derived(definitions.length > 0);
  let groups = $derived(groupBadgesWithProgress(badges, progress));
  let seasonGroup = $derived(groups.find((g) => g.category === 'season'));
  let otherGroups = $derived(
    groups.filter(
      (g) => g.category !== 'season' && (!hasTrails || !TRAIL_CATEGORIES.includes(g.category))
    )
  );
  let trails = $derived(hasTrails ? buildBadgeTrails(definitions, badges, progress) : []);
  let isEmpty = $derived(!seasonGroup && otherGroups.length === 0 && trails.length === 0);

  // One tooltip for the whole card. It is positioned against the viewport because
  // the trail rows scroll horizontally and would clip anything hanging outside them.
  // Hover shows it transiently; a tap pins it until the next tap or a tap elsewhere.
  interface Tip {
    key: string;
    badgeId: string;
    current?: number;
    threshold?: number | null;
    x: number;
    y: number;
    below: boolean;
  }
  let tip: Tip | null = $state(null);
  let pinned = $state(false);

  function place(
    el: HTMLElement,
    key: string,
    badgeId: string,
    current?: number,
    threshold?: number | null
  ): Tip {
    const r = el.getBoundingClientRect();
    const below = r.top < 96;
    const half = 128;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    return { key, badgeId, current, threshold, x, y: below ? r.bottom + 8 : r.top - 8, below };
  }

  function hover(
    el: HTMLElement,
    key: string,
    badgeId: string,
    current?: number,
    threshold?: number | null
  ) {
    if (!pinned) tip = place(el, key, badgeId, current, threshold);
  }

  function leave() {
    if (!pinned) tip = null;
  }

  function tap(
    el: HTMLElement,
    key: string,
    badgeId: string,
    current?: number,
    threshold?: number | null
  ) {
    if (pinned && tip?.key === key) {
      pinned = false;
      tip = null;
      return;
    }
    pinned = true;
    tip = place(el, key, badgeId, current, threshold);
  }

  function dismiss() {
    pinned = false;
    tip = null;
  }

  function onWindowClick(e: MouseEvent) {
    if (pinned && !(e.target as HTMLElement).closest('[data-badge-tip]')) dismiss();
  }
</script>

<svelte:window onclick={onWindowClick} onscrollcapture={dismiss} onresize={dismiss} />

{#snippet chipGroup(group: BadgeCategoryGroup)}
  <div>
    <p class="text-sm font-medium text-surface-600-400 mb-1.5">
      {$_('badges.category.' + group.category)}
    </p>
    {#if group.badges.length > 0}
      <div class="flex flex-wrap gap-2" class:mb-2={group.next}>
        {#each group.badges as badge (badgeKey(badge))}
          {@const suffix = badgeSuffix(badge)}
          {@const key = group.category + ':' + badgeKey(badge)}
          <button
            type="button"
            class="chip preset-tonal-primary text-sm"
            data-badge-tip
            aria-label={$_('badges.' + badge.badgeId + '.description')}
            onmouseenter={(e) => hover(e.currentTarget, key, badge.badgeId)}
            onmouseleave={leave}
            onclick={(e) => tap(e.currentTarget, key, badge.badgeId)}
          >
            <span>{badge.emoji}</span>
            <span>{$_('badges.' + badge.badgeId + '.name')}</span>
            {#if suffix}
              <span class="opacity-70">{suffix}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
    {#if group.next}
      {@const pct = progressPercent(group.next)}
      <div
        class="text-sm text-surface-600-400"
        title={$_('badges.' + group.next.next_badge_id + '.description')}
      >
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="truncate">
            <span class="opacity-60">{group.next.next_badge_emoji}</span>
            {$_('badges.' + group.next.next_badge_id + '.name')}
          </span>
          <span class="flex-none tabular-nums">
            {group.next.current_count}
            {$_('badges.progress.of')}
            {group.next.next_threshold}
          </span>
        </div>
        <div class="w-full h-1.5 rounded-full bg-surface-200-800 overflow-hidden">
          <div
            class="h-full rounded-full bg-primary-500 transition-all duration-500"
            style:width="{pct}%"
          ></div>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

<div>
  <h3>{$_('badges.title')}</h3>
  {#if isEmpty}
    <p class="text-surface-600-400">{$_('badges.noBadges')}</p>
  {:else}
    <div class="space-y-4">
      {#if seasonGroup}
        {@render chipGroup(seasonGroup)}
      {/if}

      {#each trails as trail (trail.category)}
        <div>
          <p class="text-sm font-medium text-surface-600-400 mb-1.5">
            {$_('badges.category.' + trail.category)}
          </p>
          <div class="overflow-x-auto -mx-1 px-1 pb-1">
            <div class="trail">
              {#each trail.steps as step (step.def.id)}
                {@const key = trail.category + ':' + step.def.id}
                {@const current = step.state === 'next' ? step.current : undefined}
                <button
                  type="button"
                  class="step {step.state}"
                  class:pinned={pinned && tip?.key === key}
                  data-badge-tip
                  aria-label={$_('badges.' + step.def.id + '.name')}
                  onmouseenter={(e) =>
                    hover(e.currentTarget, key, step.def.id, current, step.def.threshold)}
                  onmouseleave={leave}
                  onclick={(e) =>
                    tap(e.currentTarget, key, step.def.id, current, step.def.threshold)}
                >
                  <div class="tile" style:--pct="{step.pct}%">
                    <span>{step.def.emoji}</span>
                  </div>
                  <span class="lbl">
                    {#if step.state === 'next'}
                      {step.current} / {step.def.threshold}
                    {:else}
                      {step.def.threshold}
                    {/if}
                  </span>
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/each}

      {#each otherGroups as group (group.category)}
        {@render chipGroup(group)}
      {/each}
    </div>
  {/if}
</div>

{#if tip}
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
  /* Sized to its tiles so the background line ends at the last tile, not the card edge */
  .trail {
    position: relative;
    display: inline-flex;
    align-items: flex-start;
    vertical-align: top;
  }
  /* One continuous line behind the tiles, from the first centre to the last */
  .trail::before {
    content: '';
    position: absolute;
    left: 1.75rem;
    right: 1.75rem;
    top: calc(1.25rem - 1px);
    height: 2px;
    background: var(--color-surface-200-800);
  }
  .step {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    width: 3.5rem;
    flex: none;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .step:focus-visible .tile {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }
  .tile {
    position: relative;
    z-index: 1;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 9999px;
    display: grid;
    place-items: center;
    font-size: 1.15rem;
    line-height: 1;
  }
  .tile > span {
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    display: grid;
    place-items: center;
  }
  .step.done .tile {
    background: var(--color-primary-50-950);
    border: 2px solid var(--color-primary-500);
  }
  .step.next .tile {
    background: conic-gradient(var(--color-primary-500) var(--pct), var(--color-surface-200-800) 0);
  }
  .step.next .tile > span {
    width: calc(100% - 6px);
    height: calc(100% - 6px);
    background: var(--color-surface-50-950);
  }
  .step.lock .tile {
    background: var(--color-surface-200-800);
    opacity: 0.5;
    filter: grayscale(1);
    font-size: 1rem;
  }
  .step.pinned .tile {
    box-shadow:
      0 0 0 3px var(--color-surface-50-950),
      0 0 0 5px var(--color-primary-500);
  }
  .lbl {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--color-surface-600-400);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .step.next .lbl {
    color: var(--color-primary-500);
  }
  .step.lock .lbl {
    font-weight: 500;
    opacity: 0.7;
  }

  /* Tooltip: dark on light and light on dark, centred on the badge */
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
