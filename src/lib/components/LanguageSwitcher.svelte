<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faLanguage } from '@fortawesome/free-solid-svg-icons';
  import { setUserLocale } from '$lib/userLocale';
  import type { PublicLocale } from '$lib/clubConfigParser';

  const options: { value: PublicLocale; label: string }[] = [
    { value: 'de', label: 'Deutsch' },
    { value: 'en', label: 'English' }
  ];
</script>

<div class="flex items-center gap-2" role="group" aria-label={$_('button.language')}>
  <Fa icon={faLanguage} class="shrink-0 text-surface-600-400" />
  <div class="flex-1 grid grid-cols-2 gap-1">
    {#each options as option (option.value)}
      {@const active = $locale?.startsWith(option.value)}
      <button
        type="button"
        class="btn btn-sm {active ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
        aria-pressed={active}
        lang={option.value}
        onclick={() => setUserLocale(option.value)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</div>
