<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { evaluateExam, itemSides, scoresByItem, sidePoints } from '$lib/examUtils';
  import type { ExamPart, ExamResult, ExamScore } from '$lib/models';

  // A finished exam sheet as the candidate (or their parents) read it
  // afterwards: the feedback first, then every item with its points and the
  // examiners' notes.
  let {
    parts,
    minPoints,
    scores,
    result,
    feedback = null,
    examiners = []
  }: {
    parts: ExamPart[];
    minPoints: number;
    scores: ExamScore[];
    result: ExamResult;
    feedback?: string | null;
    examiners?: string[];
  } = $props();

  let byItem = $derived(scoresByItem(scores));
  let evaluation = $derived(evaluateExam(parts, minPoints, byItem));

  function pointsText(points: number | null): string {
    return points === null ? '–' : String(points);
  }
</script>

<section
  class="card border p-4 mb-4 {result === 'passed'
    ? 'border-success-500 bg-success-50-950'
    : 'border-surface-200-800'}"
>
  <p class="text-lg font-bold">
    {result === 'passed' ? $_('page.club.exams.passedTitle') : $_('page.club.exams.failedTitle')}
  </p>
  {#if parts.length > 0}
    <p class="tabular-nums">
      <span class="text-2xl font-bold">{evaluation.points}</span>
      <span class="text-surface-600-400">
        / {evaluation.max} · {$_('page.exams.sheet.min', { values: { points: minPoints } })}
      </span>
    </p>
  {/if}
  {#if examiners.length > 0}
    <p class="text-sm text-surface-600-400">
      {$_('page.exams.examiners')}: {examiners.join(', ')}
    </p>
  {/if}
  {#if feedback}
    <div class="mt-3">
      <p class="text-sm font-semibold">{$_('page.exams.sheet.feedback')}</p>
      <p class="whitespace-pre-wrap">{feedback}</p>
    </div>
  {/if}
</section>

<div class="space-y-3">
  {#each parts as part (part.key)}
    {@const pe = evaluation.parts.find((p) => p.key === part.key)}
    <section class="card border border-surface-200-800 p-3">
      <header class="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
        <h3 class="mb-0!">
          {part.title}
          {#if part.subtitle}<span class="font-normal text-surface-600-400">
              · {part.subtitle}</span
            >{/if}
        </h3>
        {#if pe}
          <span class="text-sm tabular-nums" class:text-error-600-400={!pe.met}>
            {[
              `${pe.points}/${pe.max}`,
              pe.minPoints !== null
                ? $_('page.exams.sheet.min', { values: { points: pe.minPoints } })
                : ''
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        {/if}
      </header>
      <ol class="space-y-1.5">
        {#each part.items as item (item.key)}
          {@const score = byItem.get(item.key)}
          <li class="text-sm">
            <div class="flex gap-2">
              <span class="flex-1 min-w-0">
                <span class="font-medium">{item.name}</span>
                {#if item.description}
                  <span class="text-surface-600-400"> · {item.description}</span>
                {/if}
              </span>
              <span class="flex-none tabular-nums font-semibold">
                {#each itemSides(item) as side, i (side)}
                  {#if i > 0}<span class="text-surface-500"> · </span>{/if}
                  {#if side === 'left'}{$_('page.exams.sheet.left')}&nbsp;{/if}
                  {#if side === 'right'}{$_('page.exams.sheet.right')}&nbsp;{/if}
                  {pointsText(sidePoints(score, side))}
                {/each}
              </span>
            </div>
            {#if score?.note}
              <p class="text-xs italic text-surface-600-400 mt-0.5">{score.note}</p>
            {/if}
          </li>
        {/each}
      </ol>
    </section>
  {/each}
</div>

<p class="text-xs text-surface-600-400 mt-3">
  {$_('page.exams.legend.title')}: 0 = {$_('page.exams.legend.0')} · 1 = {$_('page.exams.legend.1')} ·
  2 = {$_('page.exams.legend.2')}
</p>
