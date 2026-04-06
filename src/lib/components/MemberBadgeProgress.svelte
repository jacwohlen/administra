<script lang="ts">
  import type { BadgeProgress } from '$lib/models';
  import { _ } from 'svelte-i18n';

  let { progress }: { progress: BadgeProgress[] } = $props();
</script>

{#if progress.length > 0}
  <div class="space-y-3">
    <h3>{$_('badges.progress.title')}</h3>
    <div class="space-y-2">
      {#each progress as p}
        {@const pct = Math.min(Math.round((p.current_count / p.next_threshold) * 100), 100)}
        <div>
          <div class="flex items-center justify-between text-sm mb-1">
            <span>
              {p.next_badge_emoji}
              {$_('badges.' + p.next_badge_id + '.name')}
            </span>
            <span class="text-surface-600-400">
              {p.current_count}
              {$_('badges.progress.of')}
              {p.next_threshold}
            </span>
          </div>
          <div class="w-full bg-surface-200-800 rounded-full h-2">
            <div
              class="bg-primary-500 h-2 rounded-full transition-all duration-500"
              style:width="{pct}%"
            ></div>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}
