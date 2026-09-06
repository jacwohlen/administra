<script lang="ts">
  import type { Badge, BadgeProgress } from '$lib/models';
  import { groupBadgesWithProgress, progressPercent } from '$lib/badgeUtils';
  import { _ } from 'svelte-i18n';

  let { badges, progress = [] }: { badges: Badge[]; progress?: BadgeProgress[] } = $props();

  let grouped = $derived(groupBadgesWithProgress(badges, progress));
</script>

<div>
  <h3>{$_('badges.title')}</h3>
  {#if grouped.length === 0}
    <p class="text-surface-600-400">{$_('badges.noBadges')}</p>
  {:else}
    <div class="space-y-4">
      {#each grouped as group (group.category)}
        <div>
          <p class="text-sm font-medium text-surface-600-400 mb-1.5">
            {$_('badges.category.' + group.category)}
          </p>
          {#if group.badges.length > 0}
            <div class="flex flex-wrap gap-2" class:mb-2={group.next}>
              {#each group.badges as badge (badge.badgeId)}
                <span
                  class="chip preset-tonal-primary text-sm"
                  title={$_('badges.' + badge.badgeId + '.description')}
                >
                  <span>{badge.emoji}</span>
                  <span>{$_('badges.' + badge.badgeId + '.name')}</span>
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
      {/each}
    </div>
  {/if}
</div>
