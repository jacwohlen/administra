<script lang="ts">
  import type { RecentAchievement } from '$lib/models';
  import { badgeKey, badgeSuffix } from '$lib/badgeUtils';
  import { hoverTip, isPinned, leaveTip, tapTip } from '$lib/badgeTip.svelte';
  import BadgeTile from './BadgeTile.svelte';
  import BadgeTooltip from './BadgeTooltip.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import relativeTime from 'dayjs/plugin/relativeTime';

  dayjs.extend(relativeTime);

  let achievements: RecentAchievement[] = $state([]);
  let loading = $state(true);

  async function loadAchievements() {
    const { data, error } = await supabaseClient.rpc('get_recent_achievements', { p_limit: 10 });
    if (!error && Array.isArray(data)) {
      achievements = data as RecentAchievement[];
    }
    loading = false;
  }

  loadAchievements();
</script>

<h3 class="mb-3">{$_('badges.recentAchievements.title')}</h3>
{#if loading}
  <p class="text-surface-600-400">{$_('page.stats.loading')}</p>
{:else if achievements.length === 0}
  <p class="text-surface-600-400">{$_('badges.recentAchievements.noAchievements')}</p>
{:else}
  <ul class="flex flex-col gap-2">
    {#each achievements as a (a.memberId + ':' + badgeKey(a))}
      {@const key = a.memberId + ':' + badgeKey(a)}
      <li class="list-item">
        <button
          type="button"
          class="badge-btn"
          data-badge-tip
          aria-label={$_('badges.' + a.badgeId + '.description')}
          onmouseenter={(e) => hoverTip(e.currentTarget, key, a.badgeId)}
          onmouseleave={leaveTip}
          onclick={(e) => tapTip(e.currentTarget, key, a.badgeId)}
        >
          <BadgeTile emoji={a.emoji} pinned={isPinned(key)} />
        </button>
        <span class="list-item-content">
          <dt class="font-bold truncate">
            <a href="/dashboard/members/{a.memberId}" class="hover:underline">
              {a.firstname}
              {a.lastname}
            </a>
          </dt>
          <dd class="text-sm text-surface-600-400 truncate">
            {$_('badges.recentAchievements.earned')}
            {$_('badges.' + a.badgeId + '.name')}
            {badgeSuffix(a)}
          </dd>
        </span>
        <span class="text-xs text-surface-600-400 flex-none">
          {dayjs(a.earnedAt).fromNow()}
        </span>
      </li>
    {/each}
  </ul>
{/if}

<BadgeTooltip />

<style>
  .badge-btn {
    flex: none;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    border-radius: 9999px;
    -webkit-tap-highlight-color: transparent;
  }
  .badge-btn:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }
</style>
