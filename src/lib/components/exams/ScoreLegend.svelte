<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { SCORE_VALUES } from '$lib/examUtils';
  import { SCORE_TONES } from './examStyles';

  // What 0 / 1 / 2 mean, in the colours of the score keys
  let { class: className = '' }: { class?: string } = $props();
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-600-400 {className}">
  <span class="font-medium">{$_('page.exams.legend.title')}</span>
  {#each SCORE_VALUES as v (v)}
    <span class="inline-flex items-center gap-1.5">
      <span class="chip px-1.5 py-0 font-semibold tabular-nums {SCORE_TONES[v]}">{v}</span>
      {$_('page.exams.legend.' + v)}
    </span>
  {/each}
</div>
