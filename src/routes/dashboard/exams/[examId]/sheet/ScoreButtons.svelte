<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { SCORE_VALUES } from '$lib/examUtils';
  import { SCORE_TONES } from '$lib/components/exams/examStyles';

  let {
    value,
    label = '',
    disabled = false,
    onchange
  }: {
    /** Points given, null while not scored */
    value: number | null;
    /** Side marker ("L", "R"); empty for single-scored items */
    label?: string;
    disabled?: boolean;
    /** Tapping the chosen value again clears it */
    onchange: (value: number | null) => void;
  } = $props();
</script>

<!-- Three keys like the app's other choice groups; the chosen one takes its
     score colour (see ScoreLegend), and stays full strength on a closed sheet. -->
<div class="inline-flex flex-none items-center gap-0.5">
  <!-- Always there (empty for single-scored items), so every key group starts at the same x -->
  <span class="w-3 text-xs font-bold text-surface-600-400 text-center" aria-hidden="true">
    {label}
  </span>
  <div
    class="inline-flex rounded-lg overflow-hidden border border-surface-300-700 divide-x divide-surface-300-700"
    role="group"
    aria-label={label ? $_('page.exams.sheet.side', { values: { side: label } }) : undefined}
  >
    {#each SCORE_VALUES as v (v)}
      <button
        type="button"
        class="w-9 h-11 text-base font-semibold tabular-nums transition-colors {value === v
          ? `${SCORE_TONES[v]} disabled:opacity-100`
          : 'bg-surface-100-900 text-surface-900-50 enabled:hover:bg-surface-200-800 disabled:opacity-40'}"
        aria-pressed={value === v}
        title={$_('page.exams.legend.' + v)}
        {disabled}
        onclick={() => onchange(value === v ? null : v)}
      >
        {v}
      </button>
    {/each}
  </div>
</div>
