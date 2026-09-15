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
  import { hoverTip, isPinned, leaveTip, tapTip } from '$lib/badgeTip.svelte';
  import BadgeTile from './BadgeTile.svelte';
  import BadgeTooltip from './BadgeTooltip.svelte';
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
</script>

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
            onmouseenter={(e) => hoverTip(e.currentTarget, key, badge.badgeId)}
            onmouseleave={leaveTip}
            onclick={(e) => tapTip(e.currentTarget, key, badge.badgeId)}
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
                  data-badge-tip
                  aria-label={$_('badges.' + step.def.id + '.name')}
                  onmouseenter={(e) =>
                    hoverTip(e.currentTarget, key, step.def.id, current, step.def.threshold)}
                  onmouseleave={leaveTip}
                  onclick={(e) =>
                    tapTip(e.currentTarget, key, step.def.id, current, step.def.threshold)}
                >
                  <BadgeTile
                    emoji={step.def.emoji}
                    status={step.state}
                    pct={step.pct}
                    pinned={isPinned(key)}
                  />
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

<BadgeTooltip />

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
  .step:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
    border-radius: 0.5rem;
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
</style>
