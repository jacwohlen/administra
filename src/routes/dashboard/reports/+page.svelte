<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faFilePdf } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import { goto } from '$app/navigation';
  import dayjs from 'dayjs';
  import { buildPdf, PDF_MIME } from '#lib/pdf.ts';
  import {
    formatDays,
    activityReportPdf,
    periodLabel,
    swissDate,
    type ActivityReportLabels
  } from '#lib/activityReport.ts';
  import { toaster } from '#lib/toast.ts';

  let { data }: { data: PageData } = $props();

  let report = $derived(data.report);
  // svelte-ignore state_referenced_locally
  let from = $state(data.from);
  // svelte-ignore state_referenced_locally
  let to = $state(data.to);
  $effect(() => {
    from = data.from;
    to = data.to;
  });

  const thisYear = dayjs().year();
  const presets = [
    { key: 'thisYear', from: `${thisYear}-01-01`, to: `${thisYear}-12-31` },
    { key: 'lastYear', from: `${thisYear - 1}-01-01`, to: `${thisYear - 1}-12-31` },
    { key: 'firstHalf', from: `${thisYear}-01-01`, to: `${thisYear}-06-30` },
    { key: 'secondHalf', from: `${thisYear}-07-01`, to: `${thisYear}-12-31` }
  ];

  function show(f: string, t: string) {
    if (!f || !t) return;
    goto(`?from=${f}&to=${t}`);
  }

  function labels(): ActivityReportLabels {
    const t = (key: string, values?: Record<string, string | number>) =>
      $_(`page.reports.${key}`, values ? { values } : undefined);
    return {
      title: t('title'),
      period: t('period'),
      summary: t('summary'),
      person: t('person'),
      mainTrainer: t('mainTrainer'),
      assistant: t('assistant'),
      coachingDays: t('coachingDays'),
      total: t('total'),
      trainingsDetail: t('trainingsDetail'),
      date: t('date'),
      training: t('training'),
      section: t('section'),
      mainTrainers: t('mainTrainers'),
      assistants: t('assistants'),
      coachingDetail: t('coachingDetail'),
      participants: t('participants'),
      lessonPlan: t('lessonPlan'),
      yes: t('yes'),
      no: t('no'),
      trainingsNote: t('trainingsNote'),
      coachingNote: t('coachingNoteDetail'),
      event: t('event'),
      coaches: t('coaches'),
      checks: t('checks'),
      checksHint: t('checksHint'),
      plannedTrainer: t('plannedTrainer'),
      reason: t('reason'),
      reasons: { no_main_trainer: t('reasonNoMain') },
      page: (page, pages) => t('page', { page, pages }),
      created: t('created')
    };
  }

  function save(bytes: Uint8Array<ArrayBuffer>, mime: string, ext: string) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `einsaetze_${report.from}_${report.to}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPdf() {
    try {
      const created = dayjs().format('DD.MM.YYYY HH:mm');
      save(buildPdf(activityReportPdf(report, labels(), created)), PDF_MIME, 'pdf');
    } catch (e) {
      console.error('PDF export failed:', e);
      toaster.error({ title: $_('page.reports.downloadError') });
    }
  }
</script>

<div class="page-header">
  <h1>{$_('page.reports.title')}</h1>
</div>

<p class="text-sm text-surface-600-400 mb-4">{$_('page.reports.intro')}</p>

<form
  class="card p-3 mb-4 flex flex-wrap items-end gap-3"
  onsubmit={(e) => {
    e.preventDefault();
    show(from, to);
  }}
>
  <label class="label w-auto">
    <span class="text-sm">{$_('page.reports.from')}</span>
    <input class="input w-44" type="date" bind:value={from} required />
  </label>
  <label class="label w-auto">
    <span class="text-sm">{$_('page.reports.to')}</span>
    <input class="input w-44" type="date" bind:value={to} required />
  </label>
  <button type="submit" class="btn preset-filled-primary-500">{$_('page.reports.show')}</button>
  <div class="flex flex-wrap gap-1 w-full">
    {#each presets as p (p.key)}
      <button
        type="button"
        class="btn btn-sm {data.from === p.from && data.to === p.to
          ? 'preset-filled-surface-500'
          : 'preset-tonal-surface'}"
        onclick={() => show(p.from, p.to)}
      >
        {$_(`page.reports.${p.key}`)}
      </button>
    {/each}
  </div>
</form>

<div class="flex flex-wrap items-center justify-between gap-2 mb-2">
  <h2 class="h4 mb-0!">{periodLabel(report.from, report.to)}</h2>
  <div class="flex gap-2">
    <button
      class="btn btn-sm preset-tonal-surface"
      onclick={downloadPdf}
      disabled={report.rows.length === 0}
    >
      <Fa icon={faFilePdf} />
      <span>{$_('page.reports.downloadPdf')}</span>
    </button>
  </div>
</div>

{#if report.rows.length === 0}
  <p class="empty-state">{$_('page.reports.empty')}</p>
{:else}
  <div class="table-wrap mb-2">
    <table class="table">
      <thead>
        <tr>
          <th>{$_('page.reports.person')}</th>
          <th class="text-right!">{$_('page.reports.mainTrainer')}</th>
          <th class="text-right!">{$_('page.reports.assistant')}</th>
          <th class="text-right!">{$_('page.reports.coachingDays')}</th>
        </tr>
      </thead>
      <tbody>
        {#each report.rows as r (r.memberId)}
          <tr>
            <td>
              <a class="anchor" href="/dashboard/members/{r.memberId}">{r.name}</a>
            </td>
            <td class="text-right tabular-nums">{r.mainTrainer}</td>
            <td class="text-right tabular-nums">{r.assistant}</td>
            <td class="text-right tabular-nums">{formatDays(r.coachingDays)}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="font-bold">
          <td>{$_('page.reports.total')}</td>
          <td class="text-right tabular-nums">{report.totals.mainTrainer}</td>
          <td class="text-right tabular-nums">{report.totals.assistant}</td>
          <td class="text-right tabular-nums">{formatDays(report.totals.coachingDays)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
  <p class="text-xs text-surface-600-400 mb-4">{$_('page.reports.coachingNote')}</p>
{/if}

{#if report.checks.length > 0}
  <section class="card preset-tonal-warning p-3 mb-4">
    <h2 class="h5 mb-1">{$_('page.reports.checks')} ({report.checks.length})</h2>
    <p class="text-sm mb-2">{$_('page.reports.checksHint')}</p>
    <ul class="text-sm space-y-1">
      {#each report.checks as c, i (i)}
        <li>
          {swissDate(c.date)} · {c.training}
          {#if c.plannedTrainer}· {$_('page.reports.plannedTrainer')}: {c.plannedTrainer}{/if}
          ·
          <span class="opacity-75">{$_('page.reports.reasonNoMain')}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
