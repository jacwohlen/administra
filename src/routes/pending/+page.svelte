<script lang="ts">
  import LogoImage from '../LogoImage.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { goto, invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import { clubConfig } from '$lib/clubConfig';
  import { homePath } from '$lib/roles';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Approved, but no member record counts (left, non-member, archived, a
  // changed e-mail): nothing is pending, the access is paused
  let approved = $derived(data.userProfile?.status === 'approved');
  // Why the account is not let in, per member record (my_access()); null
  // when unknown, then no reason is given rather than a wrong one
  let statuses = $derived(data.access?.member_statuses ?? null);
  let reason = $derived.by(() => {
    if (statuses == null) return 'unknown';
    if (statuses.length === 0) return 'notOnFile';
    if (statuses.some((s) => s === 'active' || s === 'passive')) return 'awaitingApproval';
    if (statuses.every((s) => s === 'trial')) return 'trial';
    return 'inactive';
  });

  async function logout() {
    await supabaseClient.auth.signOut({ scope: 'local' });
    await goto('/');
  }

  async function refresh() {
    await invalidateAll();
    const home = homePath(data.userProfile, data.access);
    if (home !== '/pending') {
      await goto(home);
    }
  }
</script>

<div class="grid grid-cols-1 place-items-center space-y-6 mt-10 px-4 text-center">
  <LogoImage />
  {#if data.userProfile?.status === 'disabled'}
    <h1 class="my-2">{$_('page.pending.disabledTitle')}</h1>
    <p>{$_('page.pending.disabledMessage')}</p>
  {:else}
    <h1 class="my-2">
      {#if approved}
        {$_('page.pending.noAccessTitle')}
      {:else if reason === 'inactive' || reason === 'trial'}
        {$_('page.pending.inactiveTitle')}
      {:else}
        {$_('page.pending.title')}
      {/if}
    </h1>
    <div class="card max-w-md p-5 space-y-3 bg-surface-50-950 border border-surface-200-800">
      {#if data.session?.user?.email}
        <p>
          {$_('page.pending.signedInAs')}
          <strong class="break-all">{data.session.user.email}</strong>
        </p>
      {/if}
      {#if reason === 'notOnFile'}
        <p>{$_('page.pending.noMemberMatch')}</p>
      {:else if reason === 'trial'}
        <p>{$_('page.pending.trialMessage')}</p>
      {:else if reason === 'inactive'}
        <p>{$_(approved ? 'page.pending.endedMessage' : 'page.pending.inactiveMessage')}</p>
        <p class="flex flex-wrap justify-center gap-1">
          {#each statuses ?? [] as s (s)}
            <span class="chip preset-tonal-warning text-xs">{$_(`page.members.status.${s}`)}</span>
          {/each}
        </p>
        <p>{$_('page.pending.inactiveHelp')}</p>
        {#if clubConfig.contactEmail}
          <p>
            {$_('page.pending.contact')}
            <a class="anchor break-all" href="mailto:{clubConfig.contactEmail}"
              >{clubConfig.contactEmail}</a
            >
          </p>
        {/if}
      {/if}
      {#if !approved}
        <p class="text-sm text-surface-600-400">{$_('page.pending.message')}</p>
      {/if}
    </div>
  {/if}
  <div class="flex gap-2">
    <button type="button" class="btn preset-filled-primary-500" onclick={refresh}>
      {$_('button.refresh')}
    </button>
    <button type="button" class="btn preset-tonal-surface" onclick={logout}>
      {$_('page.pending.otherEmail')}
    </button>
  </div>
</div>
