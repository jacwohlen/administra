<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { itemMaxPoints, partMaxPoints, programMaxPoints } from '$lib/examUtils';
  import type { ExamPart } from '$lib/models';

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
      <header class="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
        <h3 class="mb-0!">
          {part.title}
          {#if part.subtitle}<span class="font-normal text-surface-600-400">
              · {part.subtitle}</span
            >{/if}
        </h3>
        <span class="text-sm text-surface-600-400 tabular-nums">
          {[
            $_('page.exams.programs.points', { values: { points: partMaxPoints(part) } }),
            part.minPoints ? $_('page.exams.sheet.min', { values: { points: part.minPoints } }) : ''
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </header>
      <ol class="space-y-1">
        {#each part.items as item, i (item.key)}
          <li class="flex gap-2 text-sm">
            <span class="w-5 flex-none text-surface-500 tabular-nums">{i + 1}</span>
            <div class="flex-1 min-w-0">
              <span class="font-medium">{item.name}</span>
              {#if item.description}
                <span class="text-surface-600-400"> · {item.description}</span>
              {/if}
            </div>
            <span class="flex-none text-xs text-surface-600-400 whitespace-nowrap">
              {item.sides === 2
                ? $_('page.exams.programs.bothSides')
                : $_('page.exams.programs.oneSide')} · {itemMaxPoints(item)}
            </span>
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
