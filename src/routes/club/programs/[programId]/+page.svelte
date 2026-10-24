<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import ExamProgramView from '$lib/components/exams/ExamProgramView.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.program.grade} · {data.program.title}</title>
</svelte:head>

<div class="page-header-back">
  <a
    href="/club"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.club.myProfile')}
    aria-label={$_('page.club.myProfile')}
    onclick={(e) => {
      // Back to whichever child's profile the program was opened from
      if (history.length > 1) {
        e.preventDefault();
        history.back();
      }
    }}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{data.program.grade} · {data.program.title}</h1>
</div>

<div class="mb-4">
  {#if data.grade}
    <p class="flex items-center gap-2 text-sm text-surface-600-400 mb-1">
      <BeltStrip color={data.grade.beltColor} color2={data.grade.beltColor2} size="md" />
      <span>{data.program.section}</span>
    </p>
  {/if}
  <p class="text-sm text-surface-600-400">{$_('page.club.exams.programIntro')}</p>
</div>

<ExamProgramView parts={data.program.parts} minPoints={data.program.min_points} />
