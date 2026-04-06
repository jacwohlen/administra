<script lang="ts">
  import type { RecentAchievement } from '$lib/models';
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

<div>
  <h3 class="mb-3">{$_('badges.recentAchievements.title')}</h3>
  {#if loading}
    <p class="text-surface-600-400">{$_('page.stats.loading')}</p>
  {:else if achievements.length === 0}
    <p class="text-surface-600-400">{$_('badges.recentAchievements.noAchievements')}</p>
  {:else}
    <ul class="space-y-2">
      {#each achievements as a}
        <li class="flex items-center gap-3">
          <span class="text-xl">{a.emoji}</span>
          <div class="flex-1 min-w-0">
            <a href="/dashboard/members/{a.memberId}" class="hover:underline font-medium truncate">
              {a.firstname}
              {a.lastname}
            </a>
            <p class="text-sm text-surface-600-400 truncate">
              {$_('badges.recentAchievements.earned')}
              {$_('badges.' + a.badgeId + '.name')}
            </p>
          </div>
          <span class="text-xs text-surface-600-400 flex-none">
            {dayjs(a.earnedAt).fromNow()}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
