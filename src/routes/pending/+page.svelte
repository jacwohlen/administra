<script lang="ts">
  import LogoImage from '../LogoImage.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { goto, invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import { homePath, isApproved } from '$lib/roles';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  async function logout() {
    await supabaseClient.auth.signOut({ scope: 'local' });
    await goto('/');
  }

  async function refresh() {
    await invalidateAll();
    if (isApproved(data.userProfile)) {
      await goto(homePath(data.userProfile));
    }
  }
</script>

<div class="grid grid-cols-1 place-items-center space-y-6 mt-10 px-4 text-center">
  <LogoImage />
  {#if !data.userProfile || data.userProfile.status === 'pending'}
    <h1 class="my-2">{$_('page.pending.title')}</h1>
    <div class="card max-w-md p-5 space-y-3 bg-surface-50-950 border border-surface-200-800">
      {#if data.session?.user?.email}
        <p>
          {$_('page.pending.signedInAs')}
          <strong class="break-all">{data.session.user.email}</strong>
        </p>
      {/if}
      <p>{$_('page.pending.noMemberMatch')}</p>
      <p class="text-sm text-surface-600-400">{$_('page.pending.message')}</p>
    </div>
  {:else if data.userProfile.status === 'disabled'}
    <h1 class="my-2">{$_('page.pending.disabledTitle')}</h1>
    <p>{$_('page.pending.disabledMessage')}</p>
  {/if}
  <div class="flex gap-2">
    <button type="button" class="btn preset-tonal" onclick={refresh}>
      {$_('button.refresh')}
    </button>
    <button type="button" class="btn preset-filled" onclick={logout}>
      {$_('page.pending.otherEmail')}
    </button>
  </div>
</div>
