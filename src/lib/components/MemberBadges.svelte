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
          <span
            class="chip preset-tonal-primary text-sm"
            title={$_('badges.' + badge.badgeId + '.description')}
          >
            <span>{badge.emoji}</span>
            <span>{$_('badges.' + badge.badgeId + '.name')}</span>
            {#if suffix}
              <span class="opacity-70">{suffix}</span>
            {/if}
          </span>
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
                <div
                  class="step {step.state}"
                  title="{$_('badges.' + step.def.id + '.name')}: {$_(
                    'badges.' + step.def.id + '.description'
                  )}"
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
                </div>
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

<style>
  .trail {
    display: flex;
    align-items: flex-start;
  }
  .step {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    width: 3.5rem;
    flex: none;
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
