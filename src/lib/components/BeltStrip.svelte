<script lang="ts">
  import { danLevel } from '$lib/gradeUtils';

  let {
    color,
    isDan = false,
    grade = '',
    size = 'md',
    title = ''
  }: {
    color: string;
    isDan?: boolean;
    grade?: string;
    size?: 'sm' | 'md' | 'lg';
    title?: string;
  } = $props();

  const dims = { sm: 'w-7 h-[7px]', md: 'w-11 h-[11px]', lg: 'w-16 h-4' };

  // One stripe per dan (1–6); a dan belt whose level we can't read stays plain black.
  let stripes = $derived(isDan ? (danLevel(grade) ?? 0) : 0);
</script>

<span class="belt-strip {dims[size]} {size}" style:--bc={color} {title}>
  {#if stripes > 0}
    <span class="stripes" aria-hidden="true">
      {#each Array.from({ length: stripes }, (_, i) => i) as i (i)}
        <span class="stripe"></span>
      {/each}
    </span>
  {/if}
</span>

<style>
  .belt-strip {
    display: inline-block;
    flex: none;
    border-radius: 2px;
    background: var(--bc);
    border: 1px solid rgb(0 0 0 / 0.18);
    position: relative;
    overflow: hidden;
    vertical-align: middle;
  }
  /* Dan stripes: one light bar per dan near the tip of the black belt */
  .stripes {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 12%;
    display: flex;
    gap: var(--gap);
  }
  .stripe {
    width: var(--w);
    background: rgb(255 255 255 / 0.8);
  }
  .sm {
    --w: 1px;
    --gap: 1.5px;
  }
  .md {
    --w: 1.5px;
    --gap: 2px;
  }
  .lg {
    --w: 2px;
    --gap: 2.5px;
  }
</style>
