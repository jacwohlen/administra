<script lang="ts">
  import type { Snippet } from 'svelte';
  import { _ } from 'svelte-i18n';
  import StatsSection from './StatsSection.svelte';
  import TopList from './TopList.svelte';
  import type { Rankings } from './rankings';

  /** One ranking (athletes, trainers, ...) as a card with a podium per section. */
  let {
    title,
    category,
    period,
    rankings,
    emptyText,
    actions
  }: {
    title: string;
    category: string;
    /** Year or 'ALL', as used in the detail page URL */
    period: string;
    rankings: Promise<Rankings> | Rankings;
    emptyText?: string;
    actions?: Snippet;
  } = $props();
</script>

<StatsSection {title} {actions}>
  {#await rankings}
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div class="placeholder animate-pulse h-64"></div>
      <div class="placeholder animate-pulse h-64 hidden md:block"></div>
    </div>
  {:then sections}
    {#if Object.keys(sections).length > 0}
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {#each Object.entries(sections) as [section, entries] (section)}
          <TopList
            {section}
            {entries}
            href="/dashboard/stats/{period}/top/{category}/{encodeURIComponent(section)}"
          />
        {/each}
      </div>
    {:else}
      <p class="empty-state">{emptyText ?? $_('page.stats.no_data')}</p>
    {/if}
  {:catch error}
    <p class="text-sm text-error-600-400">{error.message}</p>
  {/await}
</StatsSection>
