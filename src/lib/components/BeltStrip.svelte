<script lang="ts">
  let {
    color,
    isDan = false,
    size = 'md',
    title = ''
  }: { color: string; isDan?: boolean; size?: 'sm' | 'md' | 'lg'; title?: string } = $props();

  const dims = { sm: 'w-7 h-[7px]', md: 'w-11 h-[11px]', lg: 'w-16 h-4' };
</script>

<span class="belt-strip {dims[size]}" class:dan={isDan} style:--bc={color} {title}></span>

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
  /* Dan bars: light stitches near the tip of a black belt */
  .belt-strip.dan::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    right: 15%;
    width: 30%;
    background: repeating-linear-gradient(
      90deg,
      rgb(255 255 255 / 0.75) 0 2px,
      transparent 2px 5px
    );
  }
</style>
