<script lang="ts">
  import { PUBLIC_MODE } from '$env/static/public';
  import { invalidateAll } from '$app/navigation';
  import { supabaseClient } from '$lib/supabase';
  import { onMount } from 'svelte';
  import dayjs from 'dayjs';
  import 'dayjs/locale/de';
  import { locale } from 'svelte-i18n';
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  import '../app.css';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  $effect(() => {
    if ($locale) {
      dayjs.locale($locale.startsWith('de') ? 'de' : 'en');
    }
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
  <div class="h-screen w-screen flex flex-col">
    <div class="bg-surface-600-400 text-white text-center text-xs py-0.5">{__GIT_BRANCH__}</div>
    <div class="flex-1 overflow-hidden">
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}
