<script lang="ts">
  import type { BadgeLeaderboardEntry } from '$lib/models';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import { toaster } from '$lib/toast';

  let leaderboard: BadgeLeaderboardEntry[] = $state([]);
  let loading = $state(true);
  let refreshing = $state(false);

  async function loadLeaderboard() {
    const { data, error } = await supabaseClient.rpc('get_badge_leaderboard');

    if (error) {
      console.error('Error loading badge leaderboard:', error);
    } else if (Array.isArray(data)) {
      leaderboard = data as BadgeLeaderboardEntry[];
    }
    loading = false;
  }

  async function refreshAllBadges() {
    refreshing = true;
    const { error } = await supabaseClient.rpc('refresh_all_member_badges');
    if (error) {
      toaster.error({ title: $_('badges.refreshError') });
    } else {
      toaster.success({ title: $_('badges.refreshSuccess') });
      await loadLeaderboard();
    }
    refreshing = false;
  }

  loadLeaderboard();
</script>

<div class="flex justify-between items-center mb-3">
  <h3>{$_('badges.leaderboard')}</h3>
  <button class="btn preset-tonal-primary text-sm" onclick={refreshAllBadges} disabled={refreshing}>
    {refreshing ? $_('badges.refreshing') : $_('badges.refreshAll')}
  </button>
</div>

{#if loading}
  <p class="text-surface-600-400">{$_('page.stats.loading')}</p>
{:else if leaderboard.length === 0}
  <p class="text-surface-600-400">{$_('badges.noBadgeData')}</p>
{:else}
  <ol class="space-y-2">
    {#each leaderboard as entry, i}
      <li class="flex items-center gap-3">
        <span class="w-6 text-right text-surface-600-400 font-bold">{i + 1}.</span>
        <span class="text-lg">{entry.topBadgeEmoji}</span>
        <a href="/dashboard/members/{entry.memberId}" class="flex-1 hover:underline">
          {entry.lastname}
          {entry.firstname}
        </a>
        <span class="chip preset-tonal-secondary text-sm">
          {entry.badgeCount}
        </span>
      </li>
    {/each}
  </ol>
{/if}
