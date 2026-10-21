<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { SCORE_VALUES } from '$lib/examUtils';

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

  const tones = [
    'preset-filled-error-500',
    'preset-filled-warning-500',
    'preset-filled-success-500'
  ];
</script>

<div class="inline-flex items-center gap-1">
  {#if label}
    <span class="w-3 text-xs font-bold text-surface-600-400 text-center" aria-hidden="true">
      {label}
    </span>
  {/if}
  <div
    class="inline-flex rounded-lg overflow-hidden border border-surface-300-700"
    role="group"
    aria-label={label ? $_('page.exams.sheet.side', { values: { side: label } }) : undefined}
  >
    {#each SCORE_VALUES as v (v)}
      <button
        type="button"
        class="w-9 h-10 text-base font-semibold tabular-nums transition-colors {value === v
          ? tones[v]
          : 'preset-tonal-surface'}"
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
