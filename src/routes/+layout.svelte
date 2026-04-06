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
  <div class="h-screen w-screen flex flex-col">
    <div class="bg-surface-600-400 text-white text-center text-xs py-0.5">main</div>
    <div class="flex-1 overflow-hidden">
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}
