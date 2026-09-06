<script lang="ts">
  import { clubConfig } from '$lib/clubConfig';

  /**
   * The club's logo for public-facing pages, taken from `clubConfig.logo`
   * (PUBLIC_CLUB_LOGO — an absolute URL or a path under static/). If it ever
   * fails to load, this falls back to the Administra mark so the page never
   * shows a broken image.
   */
  const fallback = '/administra-logo.svg';

  let { class: className = '' }: { class?: string } = $props();

  let src = $state(clubConfig.logo);
</script>

<img
  {src}
  alt={clubConfig.name}
  class={className}
  onerror={() => {
    if (src !== fallback) src = fallback;
  }}
/>
