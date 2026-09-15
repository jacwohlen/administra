<script lang="ts">
  import LogoImage from '../LogoImage.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { goto, invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  async function logout() {
    await supabaseClient.auth.signOut();
    await goto('/');
  }

  async function refresh() {
    await invalidateAll();
    if (data.userProfile?.status === 'approved') {
      await goto('/dashboard');
    }
  }
</script>

<div class="grid grid-cols-1 place-items-center space-y-6 mt-10 px-4 text-center">
  <LogoImage />
  {#if !data.userProfile || data.userProfile.status === 'pending'}
    <h1 class="my-2">{$_('page.pending.title')}</h1>
    <p>{$_('page.pending.message')}</p>
    {#if data.session?.user?.email}
      <p class="opacity-70">
        {$_('page.routes.hi')} <strong>{data.session.user.email}</strong>
      </p>
    {/if}
  {:else if data.userProfile.status === 'disabled'}
    <h1 class="my-2">{$_('page.pending.disabledTitle')}</h1>
    <p>{$_('page.pending.disabledMessage')}</p>
  {/if}
  <div class="flex gap-2">
    <button type="button" class="btn preset-tonal" onclick={refresh}>
      {$_('button.refresh')}
    </button>
    <button type="button" class="btn preset-filled" onclick={logout}>
      {$_('button.logout')}
    </button>
  </div>
</div>
