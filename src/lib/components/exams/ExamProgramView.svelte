<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { itemMaxPoints, partMaxPoints, programMaxPoints } from '$lib/examUtils';
  import type { ExamPart } from '$lib/models';
  import ExamPartHeader from './ExamPartHeader.svelte';
  import ScoreLegend from './ScoreLegend.svelte';

  // An exam program as a read-only list: what to show, how many points each
  // part is worth and what is needed to pass. Shown to staff and, to
  // prepare for the next belt, to members.
  let { parts, minPoints }: { parts: ExamPart[]; minPoints: number } = $props();

  let max = $derived(programMaxPoints(parts));
</script>

<p class="text-sm text-surface-600-400 mb-3">
  {$_('page.exams.programs.summary', { values: { max, min: minPoints } })}
</p>

<div class="space-y-3">
  {#each parts as part (part.key)}
    <section class="card border border-surface-200-800 p-3">
      <ExamPartHeader title={part.title} subtitle={part.subtitle}>
        <span class="block text-sm">
          {$_('page.exams.programs.points', { values: { points: partMaxPoints(part) } })}
        </span>
        {#if part.minPoints}
          <span class="block text-xs text-surface-600-400">
            {$_('page.exams.sheet.min', { values: { points: part.minPoints } })}
          </span>
        {/if}
      </ExamPartHeader>
      <ol class="mt-2 space-y-1">
        {#each part.items as item, i (item.key)}
          <li class="flex items-baseline gap-2 text-sm">
            <span class="w-5 flex-none text-xs text-surface-500 tabular-nums">{i + 1}</span>
            <div class="flex-1 min-w-0">
              <span class="font-medium">{item.name}</span>
              {#if item.description}
                <span class="text-surface-600-400">{` ·\u00a0${item.description}`}</span>
              {/if}
            </div>
            <span
              class="flex-none text-xs text-surface-600-400 tabular-nums whitespace-nowrap"
              title={item.sides === 2
                ? $_('page.exams.programs.bothSides')
                : $_('page.exams.programs.oneSide')}
            >
              {[
                item.sides === 2 ? $_('page.exams.programs.bothSidesShort') : '',
                $_('page.exams.programs.points', { values: { points: itemMaxPoints(item) } })
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        {/each}
      </ol>
    </section>
  {/each}
</div>

<ScoreLegend class="mt-3" />
