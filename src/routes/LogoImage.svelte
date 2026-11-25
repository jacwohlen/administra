<script lang="ts">
  import { page } from '$app/state';
  import { brandForHost } from '#lib/brand.ts';
</script>

<img class="rotating" src="/administra-logo.svg" alt={brandForHost(page.url.hostname)} />

<style>
  .rotating {
    animation: rotate 2s;
  }
  @keyframes rotate {
    to {
      transform: rotate(-360deg);
    }
  }
</style>
