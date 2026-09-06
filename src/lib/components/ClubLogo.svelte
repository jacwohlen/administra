<script lang="ts">
  import { _ } from 'svelte-i18n';

  /**
   * The club's own logo for public-facing pages.
   *
   * Drop the file in as `static/club-logo.svg` (or .png and adjust `primary`)
   * and it is picked up automatically. Until then this falls back to the
   * Administra mark so the page never shows a broken image.
   */
  const primary = '/club-logo.svg';
  const fallback = '/administra-logo.svg';

  let { class: className = '' }: { class?: string } = $props();

  let src = $state(primary);
</script>

<img
  {src}
  alt={$_('page.trialRegistration.logoAlt')}
  class={className}
  onerror={() => {
    if (src !== fallback) src = fallback;
  }}
/>
