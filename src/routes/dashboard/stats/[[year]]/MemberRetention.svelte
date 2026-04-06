<script lang="ts">
  let { year, yearmode }: { year: number; yearmode: 'YEAR' | 'ALL' } = $props();

  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import { onMount } from 'svelte';

  interface RetentionData {
    new_members: number;
    returning_members: number;
    churned_members: number;
  }

  let retention: RetentionData | null = $state(null);

  async function loadRetention() {
    if (yearmode === 'ALL') {
      retention = null;
      return;
    }
    const { data } = await supabaseClient
      .rpc('get_member_retention', { year_param: year.toString() })
      .returns<RetentionData>()
      .single();
    retention = data ?? null;
  }

  onMount(() => {
    loadRetention();
  });

  $effect(() => {
    if (year || yearmode) {
      loadRetention();
    }
  });
</script>

{#if retention}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
    <div class="card p-4 text-center">
      <p class="text-3xl font-bold text-success-500">{retention.new_members}</p>
      <p class="text-sm text-surface-600-400">{$_('page.stats.newMembers')}</p>
    </div>
    <div class="card p-4 text-center">
      <p class="text-3xl font-bold text-primary-500">{retention.returning_members}</p>
      <p class="text-sm text-surface-600-400">{$_('page.stats.returningMembers')}</p>
    </div>
    <div class="card p-4 text-center">
      <p class="text-3xl font-bold text-error-500">{retention.churned_members}</p>
      <p class="text-sm text-surface-600-400">{$_('page.stats.churnedMembers')}</p>
    </div>
  </div>
{:else if yearmode === 'ALL'}
  <p class="text-surface-600-400 text-center py-4">{$_('page.stats.retentionYearOnly')}</p>
{/if}
