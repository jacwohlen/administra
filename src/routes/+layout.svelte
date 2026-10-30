<script lang="ts">
  import { PUBLIC_MODE } from '$env/static/public';
  import { setUser } from '@sentry/sveltekit';
  import { invalidateAll } from '$app/navigation';
  import { supabaseClient } from '$lib/supabase';
  import { onMount } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import { DEMO_INFO_URL } from '$lib/demo';
  import { applyDayjsLocale } from '$lib/dayjsLocale';
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  import '../app.css';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  $effect(() => {
    // Follows language switches; +layout.ts sets it before the first render
    if ($locale) applyDayjsLocale($locale);
  });

  // Error reports carry the account ID only (no name or e-mail), so a report
  // can be matched to a user_profiles row if needed.
  $effect(() => {
    const id = data.session?.user.id;
    setUser(id ? { id } : null);
  });

  onMount(() => {
    const {
      data: { subscription }
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      // Supabase reports the current session right after subscribing
      // (INITIAL_SESSION), and again when another tab refreshes it. Reload
      // only when it differs from the one the page was loaded with;
      // otherwise every page would load all of its data twice.
      if (session?.expires_at !== data.session?.expires_at) {
        invalidateAll();
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  });
  let mode = PUBLIC_MODE;
</script>

{#if mode === 'DEV'}
  <div class="h-dvh w-full flex flex-col">
    <div class="bg-surface-600-400 text-white text-center text-xs py-0.5">{__GIT_BRANCH__}</div>
    <div class="flex-1 overflow-hidden">
      {@render children()}
    </div>
  </div>
{:else if mode === 'DEMO'}
  <!--
    Same wrapper as the DEV banner (pages bring their own scroll container),
    released for printing like the dashboard layout so printouts are not cut.
    h-dvh, not h-screen: 100vh is taller than the visible area on phones
    while the browser bar shows, which would hide the bottom of each page.
  -->
  <div class="h-dvh w-full flex flex-col print:h-auto print:block">
    <p
      data-demo-banner
      class="bg-warning-500 text-surface-950 text-center text-xs leading-snug px-3 py-1 print:hidden"
    >
      {$_('demo.banner')}
      <a class="font-semibold underline whitespace-nowrap" href={DEMO_INFO_URL} rel="noopener">
        {$_('demo.learnMore')}
      </a>
    </p>
    <div class="flex-1 overflow-hidden print:overflow-visible">
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}
