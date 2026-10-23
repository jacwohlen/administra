<script lang="ts">
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faArrowsRotate,
    faChevronDown,
    faChevronRight,
    faCircleCheck,
    faCircleXmark,
    faNoteSticky,
    faRotateLeft,
    faUserPlus
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import {
    FEEDBACK_KEY,
    applyScore,
    candidateState,
    evaluateExam,
    examinerName,
    itemSides,
    scoreColumn,
    scoresByItem,
    sheetGroups,
    sidePoints,
    type ScoreSide
  } from '$lib/examUtils';
  import type { ExamCandidate, ExamItem, ExamPart, ExamResult, ExamScore } from '$lib/models';
  import { assignExaminer } from '../../queries';
  import ScoreButtons from './ScoreButtons.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Local copies, updated optimistically and replaced on every reload
  let candidates = $derived(data.candidates);
  let scores = $derived(data.scores);

  let me = $derived(data.session.user.id);
  let myName = $derived(examinerName(data.userProfile));
  let groups = $derived(sheetGroups(candidates));
  let groupIndex = $state(0);
  let group = $derived(groups[Math.min(groupIndex, groups.length - 1)] ?? []);

  let collapsed = $state<Record<string, boolean>>({});
  let openNotes = $state<Record<string, boolean>>({});
  let confirm = $state<{ candidate: ExamCandidate; result: ExamResult | null } | null>(null);
  let busy = $state(false);

  // Notes and feedback save on change; leaving the page (also with the
  // browser's or the phone's back button) must not drop what was typed.
  beforeNavigate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLTextAreaElement) el.blur();
  });

  interface Sheet {
    parts: ExamPart[];
    minPoints: number;
  }

  /** The candidate's sheet: their snapshot once started, else the current program. */
  function sheetOf(c: ExamCandidate): Sheet | null {
    if (c.program) return { parts: c.program, minPoints: c.min_points ?? 0 };
    const program = data.programs.find((p) => p.section === c.section && p.grade === c.grade);
    return program ? { parts: program.parts, minPoints: program.min_points } : null;
  }

  // The rows on screen: a started sheet's snapshot if the group has one (the
  // group shares it, see sheetGroups), else the current program. Candidates
  // not started yet are scored on, evaluated against and frozen to these rows.
  let layout = $derived.by(() => {
    const started = group.find((c) => c.program);
    return (
      (started ? sheetOf(started) : null) ?? group.map(sheetOf).find((s) => s !== null) ?? null
    );
  });

  function sheetFor(c: ExamCandidate): Sheet | null {
    return c.program ? sheetOf(c) : (layout ?? sheetOf(c));
  }

  function scoresOf(c: ExamCandidate): Map<string, ExamScore> {
    return scoresByItem(scores.filter((s) => s.candidate_id === c.id));
  }

  function feedbackOf(c: ExamCandidate): string | null {
    return scoresOf(c).get(FEEDBACK_KEY)?.note ?? null;
  }

  function evaluationOf(c: ExamCandidate) {
    const sheet = sheetFor(c);
    return sheet ? evaluateExam(sheet.parts, sheet.minPoints, scoresOf(c)) : null;
  }

  function readonly(c: ExamCandidate): boolean {
    return !data.canWrite || !!c.result || c.status === 'withdrawn';
  }

  function gradeDef(grade: string) {
    return data.ladder.find((g) => g.grade === grade);
  }

  function programTitle(c: ExamCandidate): string | undefined {
    return data.programs.find((p) => p.grade === c.grade)?.title;
  }

  function patchCandidate(id: number, patch: Partial<ExamCandidate>) {
    candidates = candidates.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  let sheets = $derived(group.map((c) => ({ c, sheet: sheetFor(c), evaluation: evaluationOf(c) })));

  /** Somebody else changed the sheet in the meantime: say so and show their state. */
  async function changedMeanwhile() {
    toaster.error({ title: $_('page.exams.sheet.changedMeanwhile') });
    await invalidate('app:exam-sheet');
  }

  /** First score on a sheet: freeze the rows on screen for it and sign as examiner. */
  async function ensureStarted(c: ExamCandidate): Promise<boolean> {
    if (!c.started_at) {
      const sheet = sheetFor(c);
      const startedAt = new Date().toISOString();
      const { data: rows, error } = await supabaseClient
        .from('exam_candidates')
        .update({
          program: sheet?.parts ?? null,
          min_points: sheet?.minPoints ?? null,
          started_at: startedAt
        })
        .eq('id', c.id)
        .is('started_at', null)
        .select('id');
      if (error) {
        console.error('Error starting sheet:', error);
        toaster.error({ title: $_('page.exams.sheet.saveError') });
        return false;
      }
      if (!rows?.length) {
        // Another examiner started it first: score on their snapshot instead
        await changedMeanwhile();
        return false;
      }
      patchCandidate(c.id, {
        started_at: startedAt,
        program: sheet?.parts ?? null,
        min_points: sheet?.minPoints ?? null
      });
    }
    if (!c.examiners?.some((e) => e.user_id === me)) {
      await joinAsExaminer(c);
    }
    return true;
  }

  async function joinAsExaminer(c: ExamCandidate) {
    const { error } = await assignExaminer([c], me, myName);
    if (error) {
      console.error('Error assigning examiner:', error);
      toaster.error({ title: $_('page.exams.assignError') });
      return;
    }
    patchCandidate(c.id, {
      examiners: [...(c.examiners ?? []), { candidate_id: c.id, user_id: me, name: myName }]
    });
  }

  async function setScore(c: ExamCandidate, item: ExamItem, side: ScoreSide, value: number | null) {
    if (!(await ensureStarted(c))) return;
    const column = scoreColumn(side);
    const previous = sidePoints(scoresOf(c).get(item.key), side);
    scores = applyScore(scores, c.id, item.key, column, value);
    const { error } = await supabaseClient
      .from('exam_scores')
      .upsert(
        { candidate_id: c.id, item_key: item.key, [column]: value },
        { onConflict: 'candidate_id,item_key' }
      );
    if (error) {
      console.error('Error saving score:', error);
      scores = applyScore(scores, c.id, item.key, column, previous);
      toaster.error({ title: $_('page.exams.sheet.saveError') });
    }
  }

  /** An item's note, or the sheet's feedback under FEEDBACK_KEY. */
  async function setNote(c: ExamCandidate, key: string, text: string) {
    const note = text.trim() || null;
    const previous = scoresOf(c).get(key)?.note ?? null;
    if (previous === note) return;
    if (!(await ensureStarted(c))) return;
    scores = applyScore(scores, c.id, key, 'note', note);
    const { error } = await supabaseClient
      .from('exam_scores')
      .upsert({ candidate_id: c.id, item_key: key, note }, { onConflict: 'candidate_id,item_key' });
    if (error) {
      console.error('Error saving note:', error);
      scores = applyScore(scores, c.id, key, 'note', previous);
      toaster.error({ title: $_('page.exams.sheet.saveError') });
    }
  }

  /** Reload first, so the dialog shows every examiner's scores. */
  async function askResult(candidate: ExamCandidate, result: ExamResult | null) {
    busy = true;
    await invalidate('app:exam-sheet');
    busy = false;
    const fresh = candidates.find((x) => x.id === candidate.id);
    if (!fresh || !!fresh.result === (result !== null)) {
      toaster.error({ title: $_('page.exams.sheet.changedMeanwhile') });
      return;
    }
    confirm = { candidate: fresh, result };
  }

  /** Finish (passed/failed) or reopen (null) a sheet. The database adds up the points. */
  async function setResult(c: ExamCandidate, result: ExamResult | null) {
    busy = true;
    if (result !== null && !c.started_at) {
      // A result without scores (no program for this grade) still needs a start
      if (!(await ensureStarted(c))) {
        busy = false;
        confirm = null;
        return;
      }
    }
    const update = supabaseClient.from('exam_candidates').update({ result }).eq('id', c.id);
    const { data: rows, error } = await (
      result === null ? update.not('result', 'is', null) : update.is('result', null)
    ).select('id');
    busy = false;
    confirm = null;
    if (error) {
      console.error('Error saving result:', error);
      toaster.error({ title: $_('page.exams.sheet.saveError') });
      return;
    }
    if (!rows?.length) {
      await changedMeanwhile();
      return;
    }
    toaster.success({
      title: result === null ? $_('page.exams.sheet.reopened') : $_('page.exams.sheet.saved')
    });
    await invalidate('app:exam-sheet');
  }

  function sideLabel(side: ScoreSide): string {
    if (side === 'left') return $_('page.exams.sheet.left');
    if (side === 'right') return $_('page.exams.sheet.right');
    return '';
  }

  function stateClass(state: string): string {
    if (state === 'passed') return 'preset-filled-success-500';
    if (state === 'failed') return 'preset-filled-error-500';
    if (state === 'grading') return 'preset-filled-warning-500';
    return 'preset-tonal-surface';
  }
</script>

<svelte:head>
  <title>{$_('page.exams.sheet.title')}</title>
</svelte:head>

<div class="page-header-back">
  <a href="/dashboard/exams/{data.exam.id}" class="btn preset-tonal-surface flex-shrink-0">
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate text-lg!">{data.exam.title}</h1>
  <button
    class="btn preset-tonal-surface"
    title={$_('button.refresh')}
    onclick={() => invalidate('app:exam-sheet')}
  >
    <Fa icon={faArrowsRotate} />
  </button>
</div>

{#if groups.length > 1}
  <div class="flex gap-2 overflow-x-auto pb-2">
    {#each groups as g, i (g[0].id)}
      <button
        class="chip flex-none {i === groupIndex
          ? 'preset-filled-primary-500'
          : 'preset-tonal-surface'}"
        onclick={() => (groupIndex = i)}
      >
        {g[0].grade} · {g.map((c) => c.member?.firstname).join(', ')}
      </button>
    {/each}
  </div>
{/if}

<!-- Candidates with their running totals, kept in view while scrolling -->
<div class="sticky top-0 z-10 bg-surface-50-950 py-2 -mx-1 px-1 border-b border-surface-200-800">
  <div class="grid gap-2 {group.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}">
    {#each sheets as { c, evaluation } (c.id)}
      {@const def = gradeDef(c.grade)}
      {@const state = candidateState(c)}
      <div class="card border border-surface-200-800 p-2 min-w-0">
        <div class="font-semibold truncate">{c.member?.firstname} {c.member?.lastname}</div>
        <div class="flex items-center gap-1 text-xs text-surface-600-400">
          {#if def}<BeltStrip color={def.beltColor} color2={def.beltColor2} size="sm" />{/if}
          <span class="truncate">{[c.grade, programTitle(c)].filter(Boolean).join(' · ')}</span>
        </div>
        <div class="flex items-baseline gap-1 mt-1">
          {#if evaluation}
            <span
              class="text-xl font-bold tabular-nums {evaluation.passed
                ? 'text-success-600-400'
                : ''}"
            >
              {evaluation.points}
            </span>
            <span class="text-xs text-surface-600-400 tabular-nums">
              / {evaluation.max} · {$_('page.exams.sheet.min', {
                values: { points: evaluation.minPoints }
              })}
            </span>
          {/if}
          <span class="chip text-[10px] ml-auto self-center flex-none {stateClass(state)}">
            {$_('page.exams.state.' + state)}
          </span>
        </div>
        {#if evaluation}
          <div class="h-1 rounded bg-surface-200-800 overflow-hidden mt-1">
            <div
              class="h-full {evaluation.complete ? 'bg-success-500' : 'bg-surface-500'}"
              style:width="{evaluation.sides ? (evaluation.scored / evaluation.sides) * 100 : 0}%"
            ></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<!-- Examiners -->
<div class="flex flex-wrap items-center gap-2 text-sm my-2">
  {#each sheets as { c } (c.id)}
    {#if group.length > 1}<span class="font-medium">{c.member?.firstname}:</span>{/if}
    <span class="text-surface-600-400">
      {c.examiners?.length
        ? c.examiners.map((e) => e.name).join(', ')
        : $_('page.exams.sheet.noExaminer')}
    </span>
    {#if !readonly(c) && !c.examiners?.some((e) => e.user_id === me)}
      <button class="btn btn-sm preset-tonal-primary" onclick={() => joinAsExaminer(c)}>
        <Fa icon={faUserPlus} />
        <span>{$_('page.exams.sheet.join')}</span>
      </button>
    {/if}
  {/each}
</div>

<p class="text-xs text-surface-600-400 mb-3">
  {$_('page.exams.legend.title')}: 0 = {$_('page.exams.legend.0')} · 1 = {$_('page.exams.legend.1')} ·
  2 = {$_('page.exams.legend.2')}
</p>

{#if !layout}
  <div class="card border border-surface-200-800 p-4 mb-4">
    <p>{$_('page.exams.sheet.noProgram', { values: { grade: group[0]?.grade ?? '' } })}</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each layout.parts as part (part.key)}
      {@const open = !collapsed[part.key]}
      <section class="card border border-surface-200-800">
        <button
          type="button"
          class="w-full flex items-start gap-2 p-3 text-left"
          aria-expanded={open}
          onclick={() => (collapsed[part.key] = open)}
        >
          <Fa icon={open ? faChevronDown : faChevronRight} class="mt-1 text-surface-500" />
          <div class="flex-1 min-w-0">
            <div class="font-bold">
              {part.title}
              {#if part.subtitle}<span class="font-normal text-surface-600-400">
                  · {part.subtitle}</span
                >{/if}
            </div>
            <div class="flex flex-wrap gap-x-3 text-xs text-surface-600-400">
              {#each sheets as { c, evaluation } (c.id)}
                {@const pe = evaluation?.parts.find((p) => p.key === part.key)}
                {#if pe}
                  <span
                    class={pe.minPoints !== null && pe.scored === pe.sides && !pe.met
                      ? 'text-error-600-400 font-semibold'
                      : ''}
                  >
                    {[
                      group.length > 1 ? c.member?.firstname : '',
                      `${pe.points}/${pe.max}`,
                      pe.minPoints !== null
                        ? `(${$_('page.exams.sheet.min', { values: { points: pe.minPoints } })})`
                        : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </span>
                {/if}
              {/each}
            </div>
          </div>
        </button>

        {#if open}
          <ol class="divide-y divide-surface-200-800 border-t border-surface-200-800">
            {#each part.items as item, i (item.key)}
              {@const key = `${group[0]?.id}:${item.key}`}
              {@const hasNote = sheets.some(({ c }) => !!scoresOf(c).get(item.key)?.note)}
              {@const writable = sheets.some(({ c }) => !readonly(c))}
              <li class="px-3 py-2">
                <div class="flex items-start gap-2">
                  <span class="text-xs text-surface-500 tabular-nums w-4 flex-none pt-1"
                    >{i + 1}</span
                  >
                  <div class="flex-1 min-w-0">
                    <span class="font-semibold">{item.name}</span>
                    {#if item.description}
                      <span class="text-sm text-surface-600-400">· {item.description}</span>
                    {/if}
                  </div>
                  {#if writable || hasNote}
                    <button
                      type="button"
                      class="btn-icon size-8 flex-none {hasNote
                        ? 'preset-tonal-warning'
                        : 'preset-tonal-surface'}"
                      title={$_('page.exams.sheet.note')}
                      aria-label={$_('page.exams.sheet.note')}
                      aria-expanded={!!openNotes[key]}
                      onclick={() => (openNotes[key] = !openNotes[key])}
                    >
                      <Fa icon={faNoteSticky} size="sm" />
                    </button>
                  {/if}
                </div>
                {#each sheets as { c } (c.id)}
                  {@const score = scoresOf(c).get(item.key)}
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    {#if group.length > 1}
                      <span class="w-12 truncate text-sm font-medium">{c.member?.firstname}</span>
                    {/if}
                    {#each itemSides(item) as side (side)}
                      <ScoreButtons
                        value={sidePoints(score, side)}
                        label={sideLabel(side)}
                        disabled={readonly(c)}
                        onchange={(v) => setScore(c, item, side, v)}
                      />
                    {/each}
                  </div>
                  {#if openNotes[key]}
                    <div class="mt-1">
                      {#if readonly(c)}
                        {#if score?.note}
                          <p class="text-sm italic whitespace-pre-wrap">
                            {#if group.length > 1}{c.member?.firstname}:{/if}
                            {score.note}
                          </p>
                        {/if}
                      {:else}
                        <textarea
                          class="textarea text-sm"
                          rows="2"
                          aria-label="{$_('page.exams.sheet.note')} {c.member?.firstname ?? ''}"
                          placeholder={group.length > 1
                            ? `${c.member?.firstname}: ${$_('page.exams.sheet.notePlaceholder')}`
                            : $_('page.exams.sheet.notePlaceholder')}
                          value={score?.note ?? ''}
                          onchange={(e) => setNote(c, item.key, e.currentTarget.value)}
                        ></textarea>
                      {/if}
                    </div>
                  {:else if score?.note}
                    <p class="text-xs italic text-surface-600-400 truncate">
                      {#if group.length > 1}{c.member?.firstname}:{/if}
                      {score.note}
                    </p>
                  {/if}
                {/each}
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    {/each}
  </div>
{/if}

<!-- Result per candidate -->
<h2 class="mt-6 mb-2 text-lg font-bold">{$_('page.exams.sheet.result')}</h2>
<div class="grid gap-3 {group.length > 1 ? 'md:grid-cols-2' : ''} pb-8">
  {#each sheets as { c, evaluation } (c.id)}
    <section class="card border border-surface-200-800 p-3 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold">{c.member?.firstname} {c.member?.lastname}</span>
        {#if c.result}
          <span class="chip text-xs {stateClass(c.result)}">
            {$_('page.exams.state.' + c.result)}
          </span>
        {/if}
      </div>

      {#if evaluation}
        <p class="tabular-nums">
          <span class="text-2xl font-bold">{evaluation.points}</span>
          <span class="text-surface-600-400">
            / {evaluation.max} · {$_('page.exams.sheet.min', {
              values: { points: evaluation.minPoints }
            })}
          </span>
        </p>
        <ul class="text-sm space-y-0.5">
          {#each evaluation.parts as pe (pe.key)}
            {@const part = sheetFor(c)?.parts.find((p) => p.key === pe.key)}
            <li class="flex justify-between gap-2" class:text-error-600-400={!pe.met}>
              <span class="truncate">{part?.title}</span>
              <span class="tabular-nums flex-none">
                {pe.points}/{pe.max}
                {#if pe.minPoints !== null}
                  <span class="text-surface-600-400">
                    ({$_('page.exams.sheet.min', { values: { points: pe.minPoints } })})
                  </span>
                  {pe.met ? '✓' : '✗'}
                {/if}
              </span>
            </li>
          {/each}
        </ul>
        {#if !c.result}
          {#if !evaluation.complete}
            <p class="text-sm text-warning-700-300">
              {$_('page.exams.sheet.unscored', {
                values: { count: evaluation.sides - evaluation.scored }
              })}
            </p>
          {/if}
          <p class="text-sm font-semibold">
            {evaluation.passed
              ? $_('page.exams.sheet.suggestPassed')
              : $_('page.exams.sheet.suggestFailed')}
          </p>
        {/if}
      {/if}

      {#if readonly(c)}
        {#if feedbackOf(c)}
          <div>
            <p class="text-xs text-surface-600-400">{$_('page.exams.sheet.feedback')}</p>
            <p class="text-sm whitespace-pre-wrap">{feedbackOf(c)}</p>
          </div>
        {/if}
      {:else}
        <label class="label">
          <span class="text-sm">{$_('page.exams.sheet.feedback')}</span>
          <textarea
            class="textarea text-sm"
            rows="3"
            placeholder={$_('page.exams.sheet.feedbackPlaceholder')}
            value={feedbackOf(c) ?? ''}
            onchange={(e) => setNote(c, FEEDBACK_KEY, e.currentTarget.value)}
          ></textarea>
          <span class="text-xs text-surface-600-400">{$_('page.exams.sheet.feedbackHint')}</span>
        </label>
      {/if}

      {#if data.canWrite && c.status !== 'withdrawn'}
        <div class="flex flex-wrap gap-2 pt-1">
          {#if c.result}
            <button
              class="btn preset-tonal-surface"
              onclick={() => askResult(c, null)}
              disabled={busy}
            >
              <Fa icon={faRotateLeft} />
              <span>{$_('page.exams.sheet.reopen')}</span>
            </button>
          {:else}
            <button
              class="btn preset-filled-success-500"
              onclick={() => askResult(c, 'passed')}
              disabled={busy}
            >
              <Fa icon={faCircleCheck} />
              <span>{$_('page.exams.sheet.pass')}</span>
            </button>
            <button
              class="btn preset-tonal-error"
              onclick={() => askResult(c, 'failed')}
              disabled={busy}
            >
              <Fa icon={faCircleXmark} />
              <span>{$_('page.exams.sheet.fail')}</span>
            </button>
          {/if}
        </div>
      {/if}
    </section>
  {/each}
</div>

{#if confirm}
  {@const c = confirm.candidate}
  {@const result = confirm.result}
  {@const evaluation = evaluationOf(c)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (confirm = null)}
    onkeydown={(e) => {
      if (e.key === 'Escape') confirm = null;
    }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('dialog.confirm.title')}</h3>
      <p class="mb-2">
        {#if result === 'passed'}
          {$_('page.exams.sheet.confirmPass', {
            values: { name: c.member?.firstname ?? '', grade: c.grade }
          })}
        {:else if result === 'failed'}
          {$_('page.exams.sheet.confirmFail', { values: { name: c.member?.firstname ?? '' } })}
        {:else}
          {$_('page.exams.sheet.confirmReopen', { values: { name: c.member?.firstname ?? '' } })}
        {/if}
      </p>
      {#if result && evaluation}
        <p class="text-sm text-surface-600-400 mb-2 tabular-nums">
          {evaluation.points} / {evaluation.max} · {$_('page.exams.sheet.min', {
            values: { points: evaluation.minPoints }
          })}
        </p>
        {#if result === 'passed' && !evaluation.passed}
          <p class="text-sm text-warning-700-300 mb-2">
            {$_('page.exams.sheet.againstSuggestion')}
          </p>
        {/if}
      {/if}
      <div class="flex justify-end gap-2 mt-4">
        <button class="btn preset-tonal-surface" onclick={() => (confirm = null)}>
          {$_('button.cancel')}
        </button>
        <button
          class="btn preset-filled-primary-500"
          onclick={() => setResult(c, result)}
          disabled={busy}
        >
          {$_('button.confirm')}
        </button>
      </div>
    </div>
  </div>
{/if}
