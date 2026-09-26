<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Fa from 'svelte-fa';
  import {
    faArrowRightFromBracket,
    faMoon,
    faScrewdriverWrench,
    faSun,
    faUser,
    faUsers
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount, type Snippet } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Toast } from '@skeletonlabs/skeleton-svelte';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import ClubLogo from '$lib/components/ClubLogo.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  let menuOpen = $state(false);
  let avatarError = $state(false);
  let isDark = $state(
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  let avatarUrl = $derived(data.session.user.user_metadata?.avatar_url as string | undefined);
  let displayName = $derived(
    (data.userProfile.full_name || data.session.user.user_metadata?.full_name || '') as string
  );
  let initials = $derived(
    displayName
      ? displayName
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join('')
      : data.userProfile.email.charAt(0).toUpperCase()
  );

  const tabs = [
    { href: '/club', label: 'page.club.myProfile', icon: faUser },
    { href: '/club/members', label: 'page.club.members', icon: faUsers }
  ];

  function isActive(href: string): boolean {
    const id = page.route.id ?? '';
    if (href === '/club') return id === '/club';
    return id.startsWith(href);
  }

  function toggleDarkMode() {
    isDark = !isDark;
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  async function logout() {
    menuOpen = false;
    await supabaseClient.auth.signOut();
    await goto('/');
  }

  onMount(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
      isDark = true;
    }
  });
</script>

<div class="h-full flex flex-col overflow-hidden">
  <header class="bg-surface-100-900 flex items-center gap-2 px-3 py-1.5">
    <a href="/club" class="flex-none" aria-label={$_('page.club.myProfile')}>
      <ClubLogo class="size-8 object-contain" />
    </a>
    <nav class="flex-1 flex gap-1 min-w-0">
      {#each tabs as tab (tab.href)}
        <a
          href={tab.href}
          class="btn btn-sm {isActive(tab.href)
            ? 'preset-filled-primary-500'
            : 'preset-tonal-surface'}"
          aria-current={isActive(tab.href) ? 'page' : undefined}
        >
          <Fa icon={tab.icon} />
          <span>{$_(tab.label)}</span>
        </a>
      {/each}
    </nav>

    <div class="flex-none relative">
      <button
        type="button"
        class="cursor-pointer flex items-center justify-center"
        aria-label={$_('page.club.accountMenu')}
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
      >
        {#if avatarUrl && !avatarError}
          <img
            src={avatarUrl}
            alt=""
            class="size-9 rounded-full object-cover hover:ring-2 ring-primary-600-400"
            onerror={() => (avatarError = true)}
          />
        {:else}
          <span
            class="size-9 rounded-full bg-primary-100-900 text-primary-800-200 flex items-center justify-center text-xs font-bold hover:ring-2 ring-primary-600-400"
          >
            {initials}
          </span>
        {/if}
      </button>
      {#if menuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="fixed inset-0 z-40"
          onclick={() => (menuOpen = false)}
          onkeydown={(e) => {
            if (e.key === 'Escape') menuOpen = false;
          }}
        ></div>
        <div
          class="absolute right-0 top-full mt-2 card p-4 w-64 shadow-xl z-50 bg-surface-50-950 border border-surface-300-700 space-y-2"
        >
          <div class="pb-2 mb-1 border-b border-surface-300-700 min-w-0">
            {#if displayName}
              <p class="font-semibold truncate">{displayName}</p>
            {/if}
            <p class="text-sm text-surface-600-400 truncate">{data.userProfile.email}</p>
          </div>
          {#if data.isStaff}
            <a
              href="/dashboard"
              class="btn preset-tonal-surface w-full"
              onclick={() => (menuOpen = false)}
            >
              <Fa icon={faScrewdriverWrench} />
              <span>{$_('page.club.toDashboard')}</span>
            </a>
          {/if}
          <button type="button" class="btn preset-tonal-surface w-full" onclick={toggleDarkMode}>
            <Fa icon={isDark ? faSun : faMoon} />
            <span>{isDark ? $_('button.lightMode') : $_('button.darkMode')}</span>
          </button>
          <button type="button" class="btn preset-filled w-full" onclick={logout}>
            <Fa icon={faArrowRightFromBracket} />
            <span>{$_('button.logout')}</span>
          </button>
        </div>
      {/if}
    </div>
  </header>

  <main class="flex-1 overflow-auto">
    <div class="max-w-2xl px-3 sm:px-4 py-4 mx-auto">
      {@render children()}
    </div>
  </main>
</div>

<Toast.Group {toaster} />
