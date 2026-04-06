<script lang="ts">
  import type { Badge } from '$lib/models';
  import { getTopBadges } from '$lib/badgeUtils';

  let { badges, count = 1 }: { badges: Badge[]; count?: number } = $props();

  let topBadges = $derived(getTopBadges(badges, count));
</script>

{#each topBadges as badge, i}
  <span class="absolute -top-0.5 -left-0.5 z-10 text-xs leading-none" style:margin-top="{i * 14}px">
    {badge.emoji}
  </span>
{/each}
