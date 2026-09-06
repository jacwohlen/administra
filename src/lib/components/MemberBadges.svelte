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

  // Tapping a badge reveals its name and description under its row.
  // Keyed by category plus badge so the same badge id in two seasons stays distinct.
  let selected: string | null = $state(null);

  function toggle(key: string) {
    selected = selected === key ? null : key;
  }
</script>

{#snippet detail(badgeId: string, current?: number, threshold?: number | null)}
  <p class="text-sm mt-2">
    <span class="font-semibold">{$_('badges.' + badgeId + '.name')}</span>
    <span class="text-surface-600-400">
      {$_('badges.' + badgeId + '.description')}{#if current !== undefined && threshold}
        · {current} {$_('badges.progress.of')} {threshold}{/if}
    </span>
  </p>
{/snippet}

{#snippet chipGroup(group: BadgeCategoryGroup)}
  {@const picked = group.badges.find((b) => selected === group.category + ':' + badgeKey(b))}
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
            class:ring-2={selected === key}
            class:ring-primary-500={selected === key}
            aria-pressed={selected === key}
            onclick={() => toggle(key)}
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
      <div class="text-sm text-surface-600-400">
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
    {#if picked}
      {@render detail(picked.badgeId)}
    {/if}
  </div>
{/snippet}

<div>
  <h3>{$_('badges.title')}</h3>
  <details class="mb-3 text-sm">
    <summary class="cursor-pointer text-surface-600-400 select-none">
      {$_('badges.howItWorks.summary')}
    </summary>
    <p class="mt-1 text-surface-600-400">{$_('badges.howItWorks.text')}</p>
  </details>
  {#if isEmpty}
    <p class="text-surface-600-400">{$_('badges.noBadges')}</p>
  {:else}
    <div class="space-y-4">
      {#if seasonGroup}
        {@render chipGroup(seasonGroup)}
      {/if}

      {#each trails as trail (trail.category)}
        {@const picked = trail.steps.find((s) => selected === trail.category + ':' + s.def.id)}
        <div>
          <p class="text-sm font-medium text-surface-600-400 mb-1.5">
            {$_('badges.category.' + trail.category)}
          </p>
          <div class="overflow-x-auto -mx-1 px-1 pb-1">
            <div class="trail">
              {#each trail.steps as step (step.def.id)}
                {@const key = trail.category + ':' + step.def.id}
                <button
                  type="button"
                  class="step {step.state}"
                  class:selected={selected === key}
                  aria-pressed={selected === key}
                  aria-label={$_('badges.' + step.def.id + '.name')}
                  onclick={() => toggle(key)}
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
          {#if picked}
            {@render detail(
              picked.def.id,
              picked.state === 'next' ? picked.current : undefined,
              picked.def.threshold
            )}
          {/if}
        </div>
      {/each}

      {#each otherGroups as group (group.category)}
        {@render chipGroup(group)}
      {/each}
    </div>
  {/if}
</div>

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
  .step.selected .tile {
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
</style>
