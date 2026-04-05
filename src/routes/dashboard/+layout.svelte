<script lang="ts">
  import { goto } from '$app/navigation';
  import { Tabs, Avatar, Toast } from '@skeletonlabs/skeleton-svelte';
  import { page } from '$app/state';
  import Fa from 'svelte-fa';
  import {
    faCalendarCheck,
    faChartSimple,
    faList,
    faUser,
    faCalendarDays
  } from '@fortawesome/free-solid-svg-icons';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { supabaseClient } from '$lib/supabase';
  import { enhance } from '$app/forms';
  import type { LayoutData } from './$types';
  import { _ } from 'svelte-i18n';
  import type { Snippet } from 'svelte';
  import { toaster } from '$lib/toast';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const submitLogout: SubmitFunction = async ({ cancel }) => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.log(error);
    }
    cancel();
  };

  function getActiveTab(): string {
    if (page.route.id == '/dashboard') return 'today';
    if (page.route.id?.startsWith('/dashboard/trainings')) return 'trainings';
    if (page.route.id?.startsWith('/dashboard/events')) return 'events';
    if (page.route.id?.startsWith('/dashboard/members')) return 'members';
    if (page.route.id?.startsWith('/dashboard/stats')) return 'stats';
    return 'today';
  }

  function getInitials(): string {
    let fullname = data.session.user.user_metadata.full_name;
    if (fullname === null || fullname.length === 0) {
      return '';
    }
    const arr = fullname.split(' ');
    if (arr?.length >= 2) {
      return arr[0].charAt(0) + arr[1].charAt(0);
    } else {
      return arr[0].charAt(0);
    }
  }

  let popoverOpen = $state(false);
</script>

<div class="h-full flex flex-col overflow-hidden">
  <!-- Header -->
  <header class="bg-surface-100-900 border-b border-surface-300-700 flex items-center px-2 py-2">
    <Tabs
      value={getActiveTab()}
      onValueChange={(e) => {
        const routes: Record<string, string> = {
          today: '/dashboard',
          trainings: '/dashboard/trainings',
          events: '/dashboard/events',
          members: '/dashboard/members',
          stats: '/dashboard/stats'
        };
        if (e.value && routes[e.value]) goto(routes[e.value]);
      }}
      class="flex-1"
    >
      <Tabs.List>
        <Tabs.Trigger value="today">
          <Fa icon={faCalendarCheck} class="mx-auto" />
          <div>{$_('page.dashboard.today')}</div>
        </Tabs.Trigger>
        <Tabs.Trigger value="trainings">
          <Fa icon={faList} class="mx-auto" />
          <div>{$_('page.dashboard.trainings')}</div>
        </Tabs.Trigger>
        <Tabs.Trigger value="events">
          <Fa icon={faCalendarDays} class="mx-auto" />
          <div>{$_('page.dashboard.events')}</div>
        </Tabs.Trigger>
        <Tabs.Trigger value="members">
          <Fa icon={faUser} class="mx-auto" />
          <div>{$_('page.dashboard.members')}</div>
        </Tabs.Trigger>
        <Tabs.Trigger value="stats">
          <Fa icon={faChartSimple} class="mx-auto" />
          <div>{$_('page.dashboard.stats')}</div>
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs>

    <!-- Profile avatar -->
    <div class="ml-auto my-auto pr-2 relative">
      <button type="button" class="cursor-pointer" onclick={() => (popoverOpen = !popoverOpen)}>
        {#if data.session.user.user_metadata.avatar_url != null}
          <Avatar class="size-10 hover:ring-2 ring-primary-500-400">
            <Avatar.Image src={data.session.user.user_metadata.avatar_url} alt="Profile" />
          </Avatar>
        {:else}
          <Avatar class="size-10 hover:ring-2 ring-primary-500-400">
            <Avatar.Fallback>{getInitials()}</Avatar.Fallback>
          </Avatar>
        {/if}
      </button>
      {#if popoverOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute right-0 top-full mt-2 card p-4 w-64 shadow-xl z-50 bg-surface-50-950 border border-surface-300-700"
          onmouseleave={() => (popoverOpen = false)}
        >
          <form action="/logout" method="POST" use:enhance={submitLogout}>
            <button type="submit" class="btn preset-filled w-full">
              {$_('button.logout')}
            </button>
          </form>
        </div>
      {/if}
    </div>
  </header>

  <!-- Main content -->
  <main class="flex-1 overflow-auto">
    <div class="container p-2 mx-auto">
      {@render children()}
    </div>
  </main>
</div>

<Toast.Group {toaster} />
