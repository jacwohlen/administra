<script lang="ts">
  import { page } from '$app/state';
  import { _ } from 'svelte-i18n';
  import LogoImage from './LogoImage.svelte';

  // Expected errors (404, 403, ...) carry their own message; for unexpected
  // ones SvelteKit only says "Internal Error".
  let unexpected = $derived(page.status >= 500);
</script>

<div class="grid grid-cols-1 place-items-center space-y-6 mt-10 px-4 text-center">
  <LogoImage />
  <h1 class="my-2">{unexpected ? $_('page.error.unexpectedTitle') : $_('page.error.title')}</h1>
  <div class="card max-w-md p-5 space-y-3 bg-surface-50-950 border border-surface-200-800">
    {#if unexpected}
      <p>{$_('page.error.unexpectedMessage')}</p>
    {:else if page.status === 404}
      <p>{$_('page.error.notFound')}</p>
    {:else}
      <p>{page.error?.message}</p>
    {/if}
    {#if page.error?.errorId}
      <p class="text-sm text-surface-600-400">
        {$_('page.error.errorId')}
        <code class="block break-all select-all">{page.error.errorId}</code>
      </p>
    {/if}
  </div>
  <a class="btn preset-filled-primary-500" href="/">{$_('page.error.home')}</a>
</div>
