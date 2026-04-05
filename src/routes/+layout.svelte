<script lang="ts">
  import { PUBLIC_MODE } from '$env/static/public';
  import { invalidateAll } from '$app/navigation';
  import { supabaseClient } from '$lib/supabase';
  import { onMount } from 'svelte';
  import dayjs from 'dayjs';
  import 'dayjs/locale/de';
  import { locale } from 'svelte-i18n';
  import type { Snippet } from 'svelte';

  import '../app.css';

  let { children }: { children: Snippet } = $props();

  $effect(() => {
    if ($locale) {
      dayjs.locale($locale.startsWith('de') ? 'de' : 'en');
    }
  });

  onMount(() => {
    const {
      data: { subscription }
    } = supabaseClient.auth.onAuthStateChange(() => {
      console.log('Auth state change detected');
      invalidateAll();
    });
    return () => {
      subscription.unsubscribe();
    };
  });
  let mode = PUBLIC_MODE;
</script>

{#if mode === 'DEV'}
  <div class="relative overflow-hidden h-screen w-screen bg-white border">
    <div class="absolute left-0 top-0 h-16 w-16 pointer-events-none z-50">
      <div
        class="absolute transform -rotate-45 bg-surface-600 text-center text-white font-semibold py-1 left-[-34px] top-[32px] w-[170px]"
      >
        main
      </div>
    </div>
    {@render children()}
  </div>
{:else}
  {@render children()}
{/if}
