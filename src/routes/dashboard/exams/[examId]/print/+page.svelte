<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft, faPrint } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { groupCandidates } from '$lib/examUtils';
  import type { PageData } from './$types';

  // The registration list for the dojo wall, like the paper sheet it replaces:
  // everyone sees who is registered, and late entries can be written in.
  let { data }: { data: PageData } = $props();

  const EMPTY_ROWS = 8;

  let rows = $derived(groupCandidates(data.candidates).flatMap((g) => g.candidates));
</script>

<svelte:head>
  <title>{data.exam.title}</title>
</svelte:head>

<div class="page-header-back print:hidden">
  <a
    href="/dashboard/exams/{data.exam.id}"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.exams.backToDay')}
    aria-label={$_('page.exams.backToDay')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{$_('page.exams.print.title')}</h1>
  <button class="btn preset-filled-primary-500 flex-shrink-0" onclick={() => window.print()}>
    <Fa icon={faPrint} />
    <span>{$_('page.exams.print.print')}</span>
  </button>
</div>

<article class="print-sheet">
  <h2 class="text-xl font-bold">{data.exam.title}</h2>
  <p class="mb-1">
    {dayjs(data.exam.date).format('DD.MM.YYYY')}{#if data.exam.location}, {data.exam.location}{/if}
    {#if data.exam.registration_deadline}
      · {$_('page.exams.deadline')}: {dayjs(data.exam.registration_deadline).format('DD.MM.YYYY')}
    {/if}
  </p>
  {#if data.exam.notes}
    <p class="mb-3 whitespace-pre-wrap">{data.exam.notes}</p>
  {/if}

  <!-- On a phone the table scrolls sideways; on paper it fits the page -->
  <div class="overflow-x-auto print:overflow-visible">
    <table class="w-full text-sm border-collapse">
      <thead>
        <tr>
          <th>{$_('page.exams.print.nr')}</th>
          <th>{$_('page.exams.print.lastname')}</th>
          <th>{$_('page.exams.print.firstname')}</th>
          <th>{$_('page.exams.print.year')}</th>
          <th>{$_('page.exams.print.grade')}</th>
          <th>{$_('page.exams.print.beltLength')}</th>
          <th>{$_('page.exams.print.trainer')}</th>
          <th>{$_('page.exams.print.group')}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as c, i (c.id)}
          <tr>
            <td>{i + 1}</td>
            <td>{c.member?.lastname}</td>
            <td>{c.member?.firstname}</td>
            <td>{c.member?.birthday?.slice(0, 4) ?? ''}</td>
            <td>{c.grade}</td>
            <td>{c.belt_length_cm ?? ''}</td>
            <td>{c.trainer ?? ''}</td>
            <td>{[c.group_name, c.call_time].filter(Boolean).join(' · ')}</td>
          </tr>
        {/each}
        {#each Array.from({ length: EMPTY_ROWS }, (_, i) => i) as i (i)}
          <tr class="h-8">
            <td>{rows.length + i + 1}</td>
            <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</article>

<style>
  th,
  td {
    border: 1px solid currentColor;
    padding: 0.25rem 0.4rem;
    text-align: left;
  }
  th {
    font-weight: 600;
    white-space: nowrap;
  }
  /* On screen the list scrolls sideways instead of wrapping every cell */
  @media screen {
    td {
      white-space: nowrap;
    }
  }
  @media print {
    .print-sheet {
      color: black;
    }
  }
</style>
