<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft, faChevronRight, faPlus } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import { gradesBySection } from '$lib/gradeUtils';
  import { programMaxPoints } from '$lib/examUtils';
  import type { GradeDefinition } from '$lib/models';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let ladders = $derived(
    [...gradesBySection(data.gradeDefinitions).entries()].map(([section, grades]) => ({
      section,
      grades: grades.filter((g) => !g.isDan)
    }))
  );
  let creating = $state(false);

  function programOf(g: GradeDefinition) {
    return data.programs.find((p) => p.section === g.section && p.grade === g.grade);
  }

  /** Start an empty program for a grade and open it in the editor. */
  async function create(g: GradeDefinition) {
    creating = true;
    const { data: row, error } = await supabaseClient
      .from('exam_programs')
      .insert({ section: g.section, grade: g.grade, title: g.grade, min_points: 0, parts: [] })
      .select('id')
      .single();
    creating = false;
    if (error || !row) {
      console.error('Error creating program:', error);
      toaster.error({ title: $_('page.exams.programs.saveError') });
      return;
    }
    await goto(`/dashboard/exams/programs/${row.id}?edit`);
  }
</script>

<div class="page-header-back">
  <a
    href="/dashboard/exams"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.exams.backToList')}
    aria-label={$_('page.exams.backToList')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{$_('page.exams.programs.title')}</h1>
</div>

<p class="text-sm text-surface-600-400 mb-4">{$_('page.exams.programs.intro')}</p>

<div class="space-y-6">
  {#each ladders as ladder (ladder.section)}
    <section>
      <h3>{ladder.section}</h3>
      <ul
        class="card border border-surface-200-800 divide-y divide-surface-200-800 overflow-hidden"
      >
        {#each ladder.grades as g (g.grade)}
          {@const program = programOf(g)}
          <li>
            {#if program}
              <a
                href="/dashboard/exams/programs/{program.id}"
                class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-100-900 transition-colors"
              >
                <BeltStrip color={g.beltColor} color2={g.beltColor2} size="md" />
                <div class="flex-1 min-w-0">
                  <div class="font-semibold truncate">{g.grade} · {program.title}</div>
                  <div class="text-xs text-surface-600-400">
                    {$_('page.exams.programs.summary', {
                      values: { max: programMaxPoints(program.parts), min: program.min_points }
                    })}
                  </div>
                </div>
                <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
              </a>
            {:else}
              <div class="flex items-center gap-3 px-3 py-2.5">
                <BeltStrip color={g.beltColor} color2={g.beltColor2} size="md" />
                <div class="flex-1 min-w-0">
                  <div class="font-semibold">{g.grade}</div>
                  <div class="text-xs text-surface-600-400">{$_('page.exams.programs.none')}</div>
                </div>
                {#if data.canManageExams}
                  <button
                    class="btn btn-sm preset-tonal-primary flex-none"
                    onclick={() => create(g)}
                    disabled={creating}
                  >
                    <Fa icon={faPlus} />
                    <span>{$_('page.exams.programs.create')}</span>
                  </button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
