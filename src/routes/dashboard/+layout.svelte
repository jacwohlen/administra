<script lang="ts">
  import { goto } from '$app/navigation';
  import { Tabs, Toast } from '@skeletonlabs/skeleton-svelte';
  import { page } from '$app/state';
  import Fa from 'svelte-fa';
  import {
    faCalendarCheck,
    faChartSimple,
    faList,
    faUser,
    faCalendarDays,
    faSun,
    faMoon
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
  let avatarError = $state(false);
  let isDark = $state(
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  function toggleDarkMode() {
    isDark = !isDark;
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  import { onMount } from 'svelte';
  onMount(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
      isDark = true;
    }
  });
</script>

<div class="h-full flex flex-col overflow-hidden">
  <!-- Header -->
  <header class="bg-surface-100-900 flex items-end px-2 pt-2">
    <div class="flex-1 min-w-0 overflow-hidden">
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
          if (e.value && routes[e.value]) goto(routes[e.value], { invalidateAll: true });
        }}
      >
        <Tabs.List>
          <Tabs.Trigger
            value="today"
            onclick={() => {
              if (getActiveTab() === 'today') goto('/dashboard', { invalidateAll: true });
            }}
          >
            <Fa icon={faCalendarCheck} scale={1.4} />
            <span class="hidden sm:inline">{$_('page.dashboard.today')}</span>
          </Tabs.Trigger>
          <Tabs.Trigger
            value="trainings"
            onclick={() => {
              if (getActiveTab() === 'trainings')
                goto('/dashboard/trainings', { invalidateAll: true });
            }}
          >
            <Fa icon={faList} scale={1.4} />
            <span class="hidden sm:inline">{$_('page.dashboard.trainings')}</span>
          </Tabs.Trigger>
          <Tabs.Trigger
            value="events"
            onclick={() => {
              if (getActiveTab() === 'events') goto('/dashboard/events', { invalidateAll: true });
            }}
          >
            <Fa icon={faCalendarDays} scale={1.4} />
            <span class="hidden sm:inline">{$_('page.dashboard.events')}</span>
          </Tabs.Trigger>
          <Tabs.Trigger
            value="members"
            onclick={() => {
              if (getActiveTab() === 'members') goto('/dashboard/members', { invalidateAll: true });
            }}
          >
            <Fa icon={faUser} scale={1.4} />
            <span class="hidden sm:inline">{$_('page.dashboard.members')}</span>
          </Tabs.Trigger>
          <Tabs.Trigger
            value="stats"
            onclick={() => {
              if (getActiveTab() === 'stats') goto('/dashboard/stats', { invalidateAll: true });
            }}
          >
            <Fa icon={faChartSimple} scale={1.4} />
            <span class="hidden sm:inline">{$_('page.dashboard.stats')}</span>
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs>
    </div>

    <!-- Profile avatar -->
    <div class="shrink-0 flex items-center pr-2 relative">
      <button type="button" class="cursor-pointer" onclick={() => (popoverOpen = !popoverOpen)}>
        {#if data.session.user.user_metadata.avatar_url && !avatarError}
          <img
            src={data.session.user.user_metadata.avatar_url}
            alt="Profile"
            class="size-10 rounded-full object-cover hover:ring-2 ring-primary-600-400"
            onerror={() => (avatarError = true)}
          />
        {:else}
          <div
            class="size-10 rounded-full bg-surface-100-900 flex items-center justify-center text-sm font-bold hover:ring-2 ring-primary-600-400"
          >
            {getInitials()}
          </div>
        {/if}
      </button>
      {#if popoverOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute right-0 top-full mt-2 card p-4 w-64 shadow-xl z-50 bg-surface-50-950 border border-surface-300-700"
          onmouseleave={() => (popoverOpen = false)}
        >
          <button
            type="button"
            class="btn preset-tonal-surface w-full mb-2"
            onclick={toggleDarkMode}
          >
            <Fa icon={isDark ? faSun : faMoon} />
            <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
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
