<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import ExamResultSheet from '$lib/components/exams/ExamResultSheet.svelte';
  import { FEEDBACK_KEY } from '$lib/examUtils';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let c = $derived(data.candidate);
  let feedback = $derived(data.scores.find((s) => s.item_key === FEEDBACK_KEY)?.note ?? null);
</script>

<svelte:head>
  <title>{$_('page.club.exams.sheetTitle')}</title>
</svelte:head>

<div class="page-header-back">
  <a
    href="/club?m={c.member_id}"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.club.myProfile')}
    aria-label={$_('page.club.myProfile')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <div class="flex-1 min-w-0">
    <h1 class="truncate">{c.member?.firstname} {c.member?.lastname} · {c.grade}</h1>
    {#if c.exam}
      <p class="text-sm text-surface-600-400">
        {c.exam.title} · {dayjs(c.exam.date).format('DD.MM.YYYY')}
      </p>
    {/if}
  </div>
</div>

{#if c.result}
  <ExamResultSheet
    parts={c.program ?? []}
    minPoints={c.min_points ?? 0}
    scores={data.scores}
    result={c.result}
    {feedback}
    examiners={data.examiners}
  />
{/if}
