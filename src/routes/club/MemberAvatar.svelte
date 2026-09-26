<script lang="ts">
  let {
    src = null,
    firstname,
    lastname,
    size = 'sm',
    ringColor = null
  }: {
    src?: string | null;
    firstname: string;
    lastname: string;
    size?: 'sm' | 'lg';
    /** Belt colour of the member's highest grade */
    ringColor?: string | null;
  } = $props();

  const dims = { sm: 'size-12 text-sm', lg: 'size-32 text-3xl' };
  const ring = { sm: 2, lg: 3 };

  let failed = $state(false);
</script>

<div
  class="relative flex-none rounded-full"
  style:box-shadow={ringColor
    ? `0 0 0 ${ring[size]}px var(--color-surface-50-950), 0 0 0 ${ring[size] * 2}px ${ringColor}`
    : undefined}
>
  {#if src && !failed}
    <img
      {src}
      alt="{firstname} {lastname}"
      class="{dims[size]} rounded-full object-cover"
      onerror={() => (failed = true)}
    />
  {:else}
    <div
      class="{dims[
        size
      ]} rounded-full bg-primary-100-900 text-primary-800-200 flex items-center justify-center font-bold"
      aria-hidden="true"
    >
      {firstname.charAt(0)}{lastname.charAt(0)}
    </div>
  {/if}
</div>
