<script lang="ts">
  import type { BadgeLeaderboardEntry } from '$lib/models';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import { toaster } from '$lib/toast';
  import Fa from 'svelte-fa';
  import { faRotate } from '@fortawesome/free-solid-svg-icons';
  import StatsSection from './StatsSection.svelte';

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

<StatsSection title={$_('badges.leaderboard')}>
  {#snippet actions()}
    <button
      class="btn btn-sm preset-tonal-surface"
      onclick={refreshAllBadges}
      disabled={refreshing}
      title={$_('badges.refreshAll')}
    >
      <Fa icon={faRotate} spin={refreshing} />
      <span class="hidden sm:inline"
        >{refreshing ? $_('badges.refreshing') : $_('badges.refreshAll')}</span
      >
    </button>
  {/snippet}

  {#if loading}
    <div class="space-y-2">
      {#each { length: 5 }, i (i)}
        <div class="placeholder animate-pulse h-8"></div>
      {/each}
    </div>
  {:else if leaderboard.length === 0}
    <p class="empty-state">{$_('badges.noBadgeData')}</p>
  {:else}
    <ol class="grid gap-x-6 sm:grid-cols-2">
      {#each leaderboard as entry, i (entry.memberId)}
        <li>
          <a
            href="/dashboard/members/{entry.memberId}"
            class="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-surface-100-900"
          >
            <span class="w-6 text-right text-sm text-surface-600-400 tabular-nums">{i + 1}</span>
            <span class="text-lg leading-none" aria-hidden="true">{entry.topBadgeEmoji}</span>
            <span class="flex-1 min-w-0 truncate">{entry.firstname} {entry.lastname}</span>
            <span class="chip preset-tonal-secondary text-xs tabular-nums">{entry.badgeCount}</span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</StatsSection>
