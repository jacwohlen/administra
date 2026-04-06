<script lang="ts">
  import type { Badge } from '$lib/models';
  import { groupBadgesByCategory } from '$lib/badgeUtils';
  import { _ } from 'svelte-i18n';

  let { badges }: { badges: Badge[] } = $props();

  let grouped = $derived(groupBadgesByCategory(badges));
</script>

<div class="space-y-3">
  <h3>{$_('badges.title')}</h3>
  {#if badges.length === 0}
    <p class="text-surface-600-400">{$_('badges.noBadges')}</p>
  {:else}
    {#each grouped as group}
      <div>
        <p class="text-sm text-surface-600-400 mb-1">
          {$_('badges.category.' + group.category)}
        </p>
        <div class="flex flex-wrap gap-2">
          {#each group.badges as badge}
            <span
              class="chip preset-tonal-primary text-sm"
              title={$_('badges.' + badge.badgeId + '.description')}
            >
              <span>{badge.emoji}</span>
              <span>{$_('badges.' + badge.badgeId + '.name')}</span>
            </span>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>
