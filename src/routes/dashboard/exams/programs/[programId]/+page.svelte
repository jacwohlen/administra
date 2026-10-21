<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft, faEdit } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import ExamProgramView from '$lib/components/exams/ExamProgramView.svelte';
  import ProgramEditor from './ProgramEditor.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // svelte-ignore state_referenced_locally
  let editing = $state(data.startEditing);
</script>

<div class="page-header-back">
  <a href="/dashboard/exams/programs" class="btn preset-tonal-surface flex-shrink-0">
    <Fa icon={faArrowLeft} />
  </a>
  {#if data.grade}
    <BeltStrip color={data.grade.beltColor} color2={data.grade.beltColor2} size="lg" />
  {/if}
  <h1 class="flex-1 min-w-0 truncate">{data.program.grade} · {data.program.title}</h1>
  {#if data.canWrite && !editing}
    <button
      class="btn preset-tonal-surface"
      aria-label={$_('button.edit')}
      onclick={() => (editing = true)}
    >
      <Fa icon={faEdit} />
      <span class="hidden sm:inline">{$_('button.edit')}</span>
    </button>
  {/if}
</div>

<p class="text-xs text-surface-600-400 mb-3">
  {data.program.section} · {$_('page.exams.programs.updated', {
    values: { date: dayjs(data.program.updated_at).format('DD.MM.YYYY') }
  })}
</p>

{#if editing}
  {#key data.program.updated_at}
    <ProgramEditor
      program={data.program}
      oncancel={() => (editing = false)}
      onsaved={async () => {
        await invalidate('app:exam-program');
        editing = false;
      }}
    />
  {/key}
{:else if data.program.parts.length === 0}
  <p class="empty-state">{$_('page.exams.programs.empty')}</p>
{:else}
  <ExamProgramView parts={data.program.parts} minPoints={data.program.min_points} />
{/if}
