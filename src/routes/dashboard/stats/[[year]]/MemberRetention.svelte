<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faUserPlus, faUserCheck, faUserMinus } from '@fortawesome/free-solid-svg-icons';

  interface RetentionData {
    new_members: number;
    returning_members: number;
    churned_members: number;
  }

  let retention = $state<RetentionData | null>(null);
  let loading = $state(false);

  async function loadRetention(mode: 'YEAR' | 'ALL', y: number) {
    retention = null;
    if (mode === 'ALL') return;
    loading = true;
    const { data } = await supabaseClient
      .rpc('get_member_retention', { year_param: y.toString() })
      .returns<RetentionData>()
      .single();
    // Ignore a slow answer for a year that is no longer shown
    if (mode !== yearmode || y !== year) return;
    retention = data ?? null;
    loading = false;
  }

  $effect(() => {
    loadRetention(yearmode, year);
  });

  let rows = $derived(
    retention
      ? [
          {
            icon: faUserPlus,
            tone: 'text-success-600-400',
            label: $_('page.stats.newMembers'),
            value: retention.new_members
          },
          {
            icon: faUserCheck,
            tone: 'text-primary-600-400',
            label: $_('page.stats.returningMembers'),
            value: retention.returning_members
          },
          {
            icon: faUserMinus,
            tone: 'text-error-600-400',
            label: $_('page.stats.churnedMembers'),
            value: retention.churned_members
          }
        ]
      : []
  );
</script>

{#if yearmode === 'ALL'}
  <p class="empty-state">{$_('page.stats.retentionYearOnly')}</p>
{:else if loading}
  <div class="space-y-2">
    {#each { length: 3 }, i (i)}
      <div class="placeholder animate-pulse h-12"></div>
    {/each}
  </div>
{:else if retention}
  <ul class="divide-y divide-surface-200-800">
    {#each rows as row (row.label)}
      <li class="list-item">
        <div class="entity-badge {row.tone}"><Fa icon={row.icon} /></div>
        <span class="list-item-content text-sm">{row.label}</span>
        <span class="text-2xl font-bold tabular-nums">{row.value}</span>
      </li>
    {/each}
  </ul>
{:else}
  <p class="empty-state">{$_('page.stats.no_data')}</p>
{/if}
