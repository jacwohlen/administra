<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faUserCheck } from '@fortawesome/free-solid-svg-icons';
  import {
    evaluateExam,
    itemSides,
    scoresByItem,
    sidePoints,
    type ScoreSide
  } from '$lib/examUtils';
  import type { ExamPart, ExamResult, ExamScore } from '$lib/models';
  import ExamPartHeader from './ExamPartHeader.svelte';
  import ScoreLegend from './ScoreLegend.svelte';
  import { SCORE_EMPTY, SCORE_TONES } from './examStyles';

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

  function sideLabel(side: ScoreSide): string {
    if (side === 'left') return $_('page.exams.sheet.left');
    if (side === 'right') return $_('page.exams.sheet.right');
    return '';
  }
</script>

<section
  class="card border p-4 mb-4 space-y-2 {result === 'passed'
    ? 'border-success-500 bg-success-500/5'
    : 'border-surface-200-800'}"
>
  <p class="font-semibold">
    {result === 'passed' ? $_('page.club.exams.passedTitle') : $_('page.club.exams.failedTitle')}
  </p>
  {#if parts.length > 0}
    <p class="flex items-baseline gap-1 tabular-nums">
      <span class="text-2xl font-bold leading-tight">{evaluation.points}</span>
      <span class="text-sm text-surface-600-400">
        / {evaluation.max} · {$_('page.exams.sheet.min', { values: { points: minPoints } })}
      </span>
    </p>
  {/if}
  {#if examiners.length > 0}
    <p class="meta-item text-sm text-surface-600-400">
      <Fa icon={faUserCheck} size="sm" />
      {$_('page.exams.examiners')}: {examiners.join(', ')}
    </p>
  {/if}
  {#if feedback}
    <div class="pt-3 mt-1 border-t border-surface-200-800">
      <h3 class="text-sm! font-semibold text-surface-600-400 mb-1!">
        {$_('page.exams.sheet.feedback')}
      </h3>
      <p class="whitespace-pre-wrap">{feedback}</p>
    </div>
  {/if}
</section>

<div class="space-y-3">
  {#each parts as part (part.key)}
    {@const pe = evaluation.parts.find((p) => p.key === part.key)}
    <section class="card border border-surface-200-800 p-3">
      <ExamPartHeader title={part.title} subtitle={part.subtitle}>
        {#if pe}
          <span
            class="block text-sm"
            class:text-primary-600-400={!pe.met}
            class:font-semibold={!pe.met}
          >
            {pe.points}/{pe.max}
          </span>
          {#if pe.minPoints !== null}
            <span class="block text-xs text-surface-600-400">
              {$_('page.exams.sheet.min', { values: { points: pe.minPoints } })}
            </span>
          {/if}
        {/if}
      </ExamPartHeader>
      <ol class="mt-2 divide-y divide-surface-200-800">
        {#each part.items as item (item.key)}
          {@const score = byItem.get(item.key)}
          <li class="py-1.5 text-sm">
            <div class="flex items-center gap-2">
              <span class="flex-1 min-w-0">
                <span class="font-medium">{item.name}</span>
                {#if item.description}
                  <span class="text-surface-600-400">{` · ${item.description}`}</span>
                {/if}
              </span>
              <span class="flex-none inline-flex gap-1">
                {#each itemSides(item) as side (side)}
                  {@const points = sidePoints(score, side)}
                  <span
                    class="chip px-1.5 py-0.5 font-semibold tabular-nums {points === null
                      ? SCORE_EMPTY
                      : SCORE_TONES[points]}"
                  >
                    {[sideLabel(side), points ?? '–'].filter((x) => x !== '').join(' ')}
                  </span>
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

<ScoreLegend class="mt-3" />
