<script lang="ts">
  /**
   * The round badge tile used on the member page trail and the start page feed.
   * done: earned, in colour. next: a progress ring at pct. lock: still ahead, greyed.
   */
  let {
    emoji,
    status = 'done',
    pct = 0,
    pinned = false
  }: {
    emoji: string;
    status?: 'done' | 'next' | 'lock';
    pct?: number;
    pinned?: boolean;
  } = $props();
</script>

<div class="tile {status}" class:pinned style:--pct="{pct}%">
  <span>{emoji}</span>
</div>

<style>
  .tile {
    position: relative;
    z-index: 1;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    border-radius: 9999px;
    display: grid;
    place-items: center;
    font-size: 1.15rem;
    line-height: 1;
  }
  .tile > span {
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    display: grid;
    place-items: center;
  }
  .tile.done {
    background: var(--color-primary-50-950);
    border: 2px solid var(--color-primary-500);
  }
  .tile.next {
    background: conic-gradient(var(--color-primary-500) var(--pct), var(--color-surface-200-800) 0);
  }
  .tile.next > span {
    width: calc(100% - 6px);
    height: calc(100% - 6px);
    background: var(--color-surface-50-950);
  }
  .tile.lock {
    background: var(--color-surface-200-800);
    opacity: 0.5;
    filter: grayscale(1);
    font-size: 1rem;
  }
  .tile.pinned {
    box-shadow:
      0 0 0 3px var(--color-surface-50-950),
      0 0 0 5px var(--color-primary-500);
  }
</style>
