<script lang="ts">
  import { tick } from 'svelte';
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faArrowsRotate,
    faCheck,
    faChevronDown,
    faCircleCheck,
    faCircleXmark,
    faNoteSticky,
    faRotateLeft,
    faTriangleExclamation,
    faUserCheck,
    faUserPlus,
    faXmark
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import ExamPartHeader from '$lib/components/exams/ExamPartHeader.svelte';
  import ExamStateChip from '$lib/components/exams/ExamStateChip.svelte';
  import ScoreLegend from '$lib/components/exams/ScoreLegend.svelte';
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
  // The sheet on screen follows a candidate, not a position: a reload can split groups
  let selectedId = $state<number | null>(null);
  let group = $derived(groups.find((g) => g.some((c) => c.id === selectedId)) ?? groups[0] ?? []);

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

  // A group's rows: a started sheet's snapshot if the group has one (the group
  // shares it, see sheetGroups), else the current program. Candidates not
  // started yet are scored on, evaluated against and frozen to these rows.
  function layoutOf(g: ExamCandidate[]): Sheet | null {
    const started = g.find((c) => c.program);
    return (started ? sheetOf(started) : null) ?? g.map(sheetOf).find((s) => s !== null) ?? null;
  }

  let layout = $derived(layoutOf(group));

  function sheetFor(c: ExamCandidate): Sheet | null {
    if (c.program) return sheetOf(c);
    const own = groups.find((g) => g.some((x) => x.id === c.id));
    return (own ? layoutOf(own) : null) ?? sheetOf(c);
  }

  /** The candidate as this page knows it now (a passed-in object may be older). */
  function live(c: ExamCandidate): ExamCandidate {
    return candidates.find((x) => x.id === c.id) ?? c;
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
  let pair = $derived(group.length > 1);
  // The legend helps until the first score is in; the keys carry it from then on
  let anyScored = $derived(sheets.some(({ evaluation }) => (evaluation?.scored ?? 0) > 0));

  /** Somebody else changed the sheet in the meantime: say so and show their state. */
  async function changedMeanwhile() {
    toaster.error({ title: $_('page.exams.sheet.changedMeanwhile') });
    await invalidate('app:exam-sheet');
  }

  /** Freeze the rows on screen for a candidate, for the grade on screen. */
  async function startSheet(c: ExamCandidate, sheet: Sheet): Promise<boolean> {
    const startedAt = new Date().toISOString();
    const { data: rows, error } = await supabaseClient
      .from('exam_candidates')
      .update({ program: sheet.parts, min_points: sheet.minPoints, started_at: startedAt })
      .eq('id', c.id)
      .eq('section', c.section)
      .eq('grade', c.grade)
      .is('started_at', null)
      .select('id');
    if (error) {
      console.error('Error starting sheet:', error);
      toaster.error({ title: $_('page.exams.sheet.saveError') });
      return false;
    }
    if (!rows?.length) {
      // Another examiner started it first, or the grade changed: show their state
      await changedMeanwhile();
      return false;
    }
    patchCandidate(c.id, {
      started_at: startedAt,
      program: sheet.parts,
      min_points: sheet.minPoints
    });
    return true;
  }

  // One start per candidate, however many taps and notes arrive while it runs
  const pendingStarts = new Map<number, Promise<boolean>>();

  /**
   * Before the first score or note: freeze the program for the candidate and
   * sign as examiner. Without a program there is nothing to freeze, and
   * starting would only lock the grade.
   */
  async function ensureStarted(c: ExamCandidate): Promise<boolean> {
    const now = live(c);
    const sheet = sheetFor(now);
    if (!now.started_at && sheet) {
      let start = pendingStarts.get(c.id);
      if (!start) {
        start = startSheet(now, sheet).finally(() => pendingStarts.delete(c.id));
        pendingStarts.set(c.id, start);
      }
      if (!(await start)) return false;
    }
    if (!live(c).examiners?.some((e) => e.user_id === me)) {
      await joinAsExaminer([live(c)]);
    }
    return true;
  }

  async function joinAsExaminer(list: ExamCandidate[]) {
    if (list.length === 0) return;
    const { error } = await assignExaminer(list, me, myName);
    if (error) {
      console.error('Error assigning examiner:', error);
      toaster.error({ title: $_('page.exams.assignError') });
      return;
    }
    for (const c of list) {
      const examiners = live(c).examiners ?? [];
      if (!examiners.some((e) => e.user_id === me)) {
        patchCandidate(c.id, {
          examiners: [...examiners, { candidate_id: c.id, user_id: me, name: myName }]
        });
      }
    }
  }

  /** The group's open sheets I do not sign yet; one tap joins them all. */
  let joinable = $derived(
    group.filter((c) => !readonly(c) && !c.examiners?.some((e) => e.user_id === me))
  );

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

  /** An item's note, or the sheet's feedback under FEEDBACK_KEY, from its text field. */
  async function setNote(c: ExamCandidate, key: string, field: HTMLTextAreaElement) {
    const text = field.value;
    const note = text.trim() || null;
    const previous = scoresOf(c).get(key)?.note ?? null;
    if (previous === note) return;
    // A failed save keeps what was typed in the field, so a later edit saves it again
    const keepTyped = async () => {
      await tick();
      field.value = text;
    };
    if (!(await ensureStarted(c))) {
      await keepTyped();
      return;
    }
    scores = applyScore(scores, c.id, key, 'note', note);
    const { error } = await supabaseClient
      .from('exam_scores')
      .upsert({ candidate_id: c.id, item_key: key, note }, { onConflict: 'candidate_id,item_key' });
    if (error) {
      console.error('Error saving note:', error);
      scores = applyScore(scores, c.id, key, 'note', previous);
      await keepTyped();
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
    // Whoever decides signs the sheet (and an untouched sheet gets its program)
    if (result !== null && !(await ensureStarted(c))) {
      busy = false;
      confirm = null;
      return;
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
</script>

<svelte:head>
  <title>{$_('page.exams.sheet.title')}</title>
</svelte:head>

<div class="page-header-back">
  <a
    href="/dashboard/exams/{data.exam.id}"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.exams.backToDay')}
    aria-label={$_('page.exams.backToDay')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{data.exam.title}</h1>
  <button
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('button.refresh')}
    aria-label={$_('button.refresh')}
    onclick={() => invalidate('app:exam-sheet')}
  >
    <Fa icon={faArrowsRotate} />
  </button>
</div>

{#if groups.length > 1}
  <div class="flex gap-2 overflow-x-auto pb-2" role="group">
    {#each groups as g (g[0].id)}
      <button
        class="btn btn-sm flex-none {g === group
          ? 'preset-filled-primary-500'
          : 'preset-tonal-surface'}"
        aria-pressed={g === group}
        onclick={() => (selectedId = g[0].id)}
      >
        {g[0].grade} · {g.map((c) => c.member?.firstname).join(', ')}
      </button>
    {/each}
  </div>
{/if}

<!-- Candidates with their running totals, kept in view while scrolling -->
<div class="sticky top-0 z-10 bg-surface-50-950 pt-1 pb-3">
  <div class="grid gap-2 {pair ? 'grid-cols-2' : 'grid-cols-1'}">
    {#each sheets as { c, evaluation } (c.id)}
      {@const def = gradeDef(c.grade)}
      {@const state = candidateState(c)}
      <div class="card border border-surface-200-800 p-3 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold truncate">{c.member?.firstname} {c.member?.lastname}</span>
          {#if c.result || state === 'withdrawn'}<ExamStateChip {state} />{/if}
        </div>
        <p class="flex items-center gap-1.5 text-xs text-surface-600-400 min-w-0">
          {#if def}<BeltStrip color={def.beltColor} color2={def.beltColor2} size="sm" />{/if}
          <span class="truncate">{[c.grade, programTitle(c)].filter(Boolean).join(' · ')}</span>
        </p>
        <p class="meta-item text-xs text-surface-600-400 min-w-0">
          <Fa icon={faUserCheck} size="xs" class="flex-none" />
          <span class="truncate">
            {c.examiners?.length
              ? c.examiners.map((e) => e.name).join(', ')
              : $_('page.exams.sheet.noExaminer')}
          </span>
        </p>
        {#if evaluation}
          <p class="flex items-baseline gap-1 mt-1 whitespace-nowrap tabular-nums">
            <span
              class="text-xl font-bold leading-tight {evaluation.passed
                ? 'text-success-600-400'
                : ''}"
            >
              {evaluation.points}
            </span>
            <span class="text-xs text-surface-600-400">
              / {evaluation.max} · {$_('page.exams.sheet.min', {
                values: { points: evaluation.minPoints }
              })}
            </span>
          </p>
          <div class="h-1.5 rounded-full bg-surface-200-800 overflow-hidden mt-1">
            <div
              class="h-full rounded-full transition-all duration-500 {evaluation.complete
                ? 'bg-success-500'
                : 'bg-primary-500'}"
              style:width="{evaluation.sides ? (evaluation.scored / evaluation.sides) * 100 : 0}%"
            ></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

{#if joinable.length > 0}
  <!-- Optional (the first score signs the sheet anyway), hence tonal -->
  <div class="mb-3">
    <button
      class="btn preset-tonal-primary w-full sm:w-auto"
      onclick={() => joinAsExaminer(joinable)}
    >
      <Fa icon={faUserPlus} />
      <span>{$_('page.exams.sheet.join')}</span>
    </button>
  </div>
{/if}

{#if layout && !anyScored}
  <ScoreLegend class="mb-3" />
{/if}

{#if !layout}
  <div class="card border border-surface-200-800 p-4 mb-4">
    <p>{$_('page.exams.sheet.noProgram', { values: { grade: group[0]?.grade ?? '' } })}</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each layout.parts as part (part.key)}
      {@const open = !collapsed[part.key]}
      <section class="card border border-surface-200-800 overflow-hidden">
        <button
          type="button"
          class="w-full flex items-start gap-3 p-3 text-left hover:bg-surface-100-900 transition-colors"
          aria-expanded={open}
          onclick={() => (collapsed[part.key] = open)}
        >
          <span class="block flex-1 min-w-0">
            <ExamPartHeader title={part.title} subtitle={part.subtitle} heading={false} />
            <span class="flex flex-wrap gap-x-3 text-xs text-surface-600-400 tabular-nums">
              {#each sheets as { c, evaluation } (c.id)}
                {@const pe = evaluation?.parts.find((p) => p.key === part.key)}
                {#if pe}
                  <span
                    class={pe.minPoints !== null && pe.scored === pe.sides && !pe.met
                      ? 'text-primary-600-400 font-semibold'
                      : ''}
                  >
                    {[
                      pair ? c.member?.firstname : '',
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
            </span>
          </span>
          <Fa
            icon={faChevronDown}
            size="xs"
            class="mt-1.5 text-surface-500 flex-shrink-0 transition-transform {open
              ? 'rotate-180'
              : ''}"
          />
        </button>

        {#if open}
          <ol class="divide-y divide-surface-200-800 border-t border-surface-200-800">
            {#each part.items as item, i (item.key)}
              {@const key = `${group[0]?.id}:${item.key}`}
              {@const hasNote = sheets.some(({ c }) => !!scoresOf(c).get(item.key)?.note)}
              {@const writable = sheets.some(({ c }) => !readonly(c))}
              <li class="px-2 sm:px-3 py-2">
                <div class="flex items-baseline gap-2">
                  <span class="w-4 flex-none text-xs text-surface-500 tabular-nums text-right"
                    >{i + 1}</span
                  >
                  <div class="flex-1 min-w-0">
                    <span class="font-semibold">{item.name}</span>
                    {#if item.description}
                      <span class="text-sm text-surface-600-400">· {item.description}</span>
                    {/if}
                  </div>
                  {#if writable || hasNote}
                    <!-- A full 44 px target whose negative margins keep the title row
                         one line high; only the inner square shows hover / open -->
                    <button
                      type="button"
                      class="group btn-icon size-11 p-0 -my-2.5 -mr-1 flex-none self-start {hasNote
                        ? 'text-warning-800-200'
                        : 'text-surface-400-600'}"
                      title={$_('page.exams.sheet.note')}
                      aria-label={$_('page.exams.sheet.note')}
                      aria-expanded={!!openNotes[key]}
                      onclick={() => (openNotes[key] = !openNotes[key])}
                    >
                      <span
                        class="relative size-9 flex items-center justify-center rounded-md transition-colors group-hover:bg-surface-100-900 {openNotes[
                          key
                        ]
                          ? 'bg-surface-100-900'
                          : ''}"
                      >
                        <Fa icon={faNoteSticky} />
                        {#if hasNote}
                          <span
                            class="absolute top-1 right-1 size-2 rounded-full bg-warning-500 ring-2 ring-surface-50-950"
                            aria-hidden="true"
                          ></span>
                        {/if}
                      </span>
                    </button>
                  {/if}
                </div>
                {#each sheets as { c } (c.id)}
                  {@const score = scoresOf(c).get(item.key)}
                  <div class="flex flex-nowrap items-center gap-x-1.5 mt-1.5">
                    {#if pair}
                      <span class="w-12 flex-none truncate text-sm font-medium">
                        {c.member?.firstname}
                      </span>
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
                    <div class="mt-1.5">
                      {#if readonly(c)}
                        {#if score?.note}
                          <p class="text-sm italic whitespace-pre-wrap">
                            {#if pair}{c.member?.firstname}:{/if}
                            {score.note}
                          </p>
                        {/if}
                      {:else}
                        <textarea
                          class="textarea text-sm"
                          rows="2"
                          aria-label="{$_('page.exams.sheet.note')} {c.member?.firstname ?? ''}"
                          placeholder={pair
                            ? `${c.member?.firstname}: ${$_('page.exams.sheet.notePlaceholder')}`
                            : $_('page.exams.sheet.notePlaceholder')}
                          value={score?.note ?? ''}
                          maxlength="2000"
                          onchange={(e) => setNote(c, item.key, e.currentTarget)}
                        ></textarea>
                      {/if}
                    </div>
                  {:else if score?.note}
                    <p class="text-xs italic text-surface-600-400 truncate mt-0.5">
                      {#if pair}{c.member?.firstname}:{/if}
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
<h3 class="mt-6">{$_('page.exams.sheet.result')}</h3>
<div class="grid gap-4 {pair ? 'md:grid-cols-2' : ''} pb-8">
  {#each sheets as { c, evaluation } (c.id)}
    <section class="card border border-surface-200-800 p-4 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold truncate">{c.member?.firstname} {c.member?.lastname}</span>
        {#if c.result}<ExamStateChip state={c.result} />{/if}
      </div>

      {#if evaluation}
        <p class="flex items-baseline gap-1 tabular-nums">
          <span class="text-2xl font-bold leading-tight">{evaluation.points}</span>
          <span class="text-sm text-surface-600-400">
            / {evaluation.max} · {$_('page.exams.sheet.min', {
              values: { points: evaluation.minPoints }
            })}
          </span>
        </p>
        <ul class="text-sm divide-y divide-surface-200-800">
          {#each evaluation.parts as pe (pe.key)}
            {@const part = sheetFor(c)?.parts.find((p) => p.key === pe.key)}
            <li
              class="flex items-center gap-2 py-1 tabular-nums"
              class:text-primary-600-400={!pe.met}
            >
              <span class="flex-1 min-w-0 truncate">{part?.title}</span>
              {#if pe.minPoints !== null}
                <span class="flex-none inline-flex items-center gap-1 text-xs text-surface-600-400">
                  {$_('page.exams.sheet.min', { values: { points: pe.minPoints } })}
                  <Fa
                    icon={pe.met ? faCheck : faXmark}
                    size="xs"
                    class={pe.met ? 'text-success-600-400' : 'text-primary-600-400'}
                  />
                </span>
              {/if}
              <span class="flex-none min-w-12 text-right" class:font-semibold={!pe.met}>
                {pe.points}/{pe.max}
              </span>
            </li>
          {/each}
        </ul>
        {#if !c.result}
          {#if !evaluation.complete}
            <p class="flex items-center gap-2 text-sm text-surface-700-300">
              <Fa icon={faTriangleExclamation} class="text-warning-800-200 flex-none" />
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
            maxlength="2000"
            onchange={(e) => setNote(c, FEEDBACK_KEY, e.currentTarget)}
          ></textarea>
          <span class="text-xs text-surface-600-400">{$_('page.exams.sheet.feedbackHint')}</span>
        </label>
      {/if}

      {#if data.canWrite && c.status !== 'withdrawn'}
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
          <!-- Two equal decisions; the one the points suggest is filled -->
          <div class="grid grid-cols-2 gap-2">
            <button
              class="btn {evaluation?.passed
                ? 'preset-filled-success-500'
                : 'preset-tonal-success'}"
              onclick={() => askResult(c, 'passed')}
              disabled={busy}
            >
              <Fa icon={faCircleCheck} />
              <span>{$_('page.exams.sheet.pass')}</span>
            </button>
            <button
              class="btn {evaluation && !evaluation.passed
                ? 'preset-filled-error-500'
                : 'preset-tonal-error'}"
              onclick={() => askResult(c, 'failed')}
              disabled={busy}
            >
              <Fa icon={faCircleXmark} />
              <span>{$_('page.exams.sheet.fail')}</span>
            </button>
          </div>
        {/if}
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
          <p class="flex items-start gap-2 text-sm mb-2">
            <Fa icon={faTriangleExclamation} class="text-warning-800-200 flex-none mt-1" />
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
