<script lang="ts">
  import { tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faArrowsRotate,
    faCheck,
    faCircleExclamation,
    faChevronDown,
    faCircleCheck,
    faCircleXmark,
    faNoteSticky,
    faRotateLeft,
    faTriangleExclamation,
    faUserCheck,
    faUserMinus,
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
  import {
    applyCandidateChange,
    applyExaminerChange,
    applyScoreChange,
    type RowChange
  } from '$lib/examLive';
  import type {
    ExamCandidate,
    ExamExaminer,
    ExamItem,
    ExamPart,
    ExamResult,
    ExamScore
  } from '$lib/models';
  import { assignExaminer } from '../../queries';
  import ScoreButtons from './ScoreButtons.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Local copies, updated optimistically and live, and replaced on every reload
  let candidates = $derived(data.candidates);
  let scores = $derived(data.scores);

  // Live: two examiners grading the same pair share the sheet. Their scores,
  // notes, sign-ons and results arrive through Supabase Realtime (the echo of
  // one's own writes too) in commit order, so both phones show what the
  // database holds.
  let connection = $state<'connecting' | 'live' | 'lost'>('connecting');
  // Notes someone else changed while this examiner was typing in the same field
  let noteConflicts = $state<Record<string, string>>({});
  let candidateIds = $derived(data.candidates.map((c) => c.id).join(','));

  function noteKey(candidateId: number | undefined, itemKey: string | undefined): string {
    return `${candidateId}:${itemKey}`;
  }

  function onScoreChange(change: RowChange<ExamScore>) {
    const row = change.eventType === 'DELETE' ? change.old : change.new;
    const key = noteKey(row.candidate_id, row.item_key);
    const current =
      scores.find((s) => s.candidate_id === row.candidate_id && s.item_key === row.item_key)
        ?.note ?? null;
    // What is being typed in that field stays; the field says the note changed
    const field = document.activeElement;
    const typing =
      change.eventType !== 'DELETE' &&
      field instanceof HTMLTextAreaElement &&
      field.dataset.note === key &&
      field.value !== (current ?? '') &&
      (change.new.note ?? null) !== current;
    if (typing) {
      noteConflicts[key] = change.new.note ?? '';
      change = { ...change, new: { ...change.new, note: current } };
    }
    scores = applyScoreChange(scores, change);
  }

  $effect(() => {
    const ids = candidateIds;
    if (!ids) return;
    let joined = false;
    const reload = () => invalidate('app:exam-sheet');
    const channel = supabaseClient
      // Own name per subscription: the previous one may still be leaving
      .channel(`exam-sheet:${data.exam.id}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exam_scores', filter: `candidate_id=in.(${ids})` },
        (p) => onScoreChange(p as unknown as RowChange<ExamScore>)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exam_candidates', filter: `id=in.(${ids})` },
        (p) => {
          const change = p as unknown as RowChange<ExamCandidate>;
          if (change.eventType === 'UPDATE') candidates = applyCandidateChange(candidates, change);
          else reload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'exam_examiners',
          filter: `candidate_id=in.(${ids})`
        },
        (p) =>
          (candidates = applyExaminerChange(candidates, p as unknown as RowChange<ExamExaminer>))
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Back after a break: fetch what changed meanwhile
          if (joined) reload();
          joined = true;
          connection = 'live';
        } else {
          connection = 'lost';
        }
      });
    // A phone back from standby catches up, whatever the connection missed
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabaseClient.removeChannel(channel);
    };
  });

  let me = $derived(data.session.user.id);
  let myName = $derived(examinerName(data.userProfile));
  let groups = $derived(sheetGroups(candidates));
  // The sheet on screen follows a candidate, not a position: a reload can split groups
  let selectedId = $state<number | null>(null);
  let group = $derived(groups.find((g) => g.some((c) => c.id === selectedId)) ?? groups[0] ?? []);

  // Several sheets (different grades): swipe the candidate cards, tap a dot
  // or a button above to switch. Each sheet keeps its own scroll position,
  // so an examiner alternating between candidates lands on the same item.
  let groupIndex = $derived(groups.indexOf(group));
  let stickyEl = $state<HTMLElement>();
  let sheetStart = $state<HTMLElement>();
  let chipRow = $state<HTMLElement>();
  let slideFrom = $state(0);
  let dragX = $state(0);
  let swipe: { x: number; y: number; axis: 'x' | 'y' | null } | null = null;
  const scrollTops = new Map<number, number>();
  const SWIPE_DISTANCE = 60;

  async function showGroup(index: number) {
    const target = groups[index];
    if (!target || target === group) return;
    // A note being typed is saved for the sheet it belongs to; a swipe does
    // not take the focus away, and not every browser blurs a removed field
    const el = document.activeElement;
    if (el instanceof HTMLTextAreaElement) el.blur();
    const scroller = stickyEl?.closest('main');
    if (scroller && group[0]) scrollTops.set(group[0].id, scroller.scrollTop);
    slideFrom = index > groupIndex ? 1 : -1;
    selectedId = target[0].id;
    await tick();
    if (!scroller || !sheetStart) return;
    // Back where this sheet was left; a sheet seen for the first time starts
    // at its first item (or stays put when the page is not scrolled that far)
    const top =
      scroller.scrollTop +
      sheetStart.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
    scroller.scrollTop = scrollTops.get(target[0].id) ?? Math.min(scroller.scrollTop, top);
    // The chip row (on a narrow phone it scrolls) shows the sheet on screen
    const chip = chipRow?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (chipRow && chip) {
      chipRow.scrollLeft = chip.offsetLeft - (chipRow.clientWidth - chip.offsetWidth) / 2;
    }
  }

  function swipeCancel() {
    swipe = null;
    dragX = 0;
  }

  function swipeStart(e: TouchEvent) {
    // A second finger (pinch) ends the swipe
    if (groups.length < 2 || e.touches.length !== 1) return swipeCancel();
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
  }

  function swipeMove(e: TouchEvent) {
    if (!swipe) return;
    if (e.touches.length !== 1) return swipeCancel();
    const dx = e.touches[0].clientX - swipe.x;
    const dy = e.touches[0].clientY - swipe.y;
    if (!swipe.axis && Math.hypot(dx, dy) > 10) {
      swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (swipe.axis !== 'x') return;
    // Ours, not the browser's: otherwise it treats the flick as a fling and
    // swallows the next tap
    if (e.cancelable) e.preventDefault();
    // Resists at the first and last sheet
    const end = (dx > 0 && groupIndex === 0) || (dx < 0 && groupIndex === groups.length - 1);
    dragX = end ? dx / 4 : dx;
  }

  function swipeEnd(e: TouchEvent) {
    if (!swipe || e.touches.length > 0) return;
    const dx = swipe.axis === 'x' ? dragX : 0;
    swipeCancel();
    if (Math.abs(dx) > SWIPE_DISTANCE) showGroup(groupIndex + (dx < 0 ? 1 : -1));
  }

  // Not passive (Svelte's ontouchmove is), so a horizontal swipe can claim the gesture
  $effect(() => {
    const el = stickyEl;
    if (!el) return;
    el.addEventListener('touchmove', swipeMove, { passive: false });
    return () => el.removeEventListener('touchmove', swipeMove);
  });

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function names(g: ExamCandidate[]): string {
    return `${g[0].grade} · ${g.map((c) => c.member?.firstname).join(', ')}`;
  }

  // Per sheet (parts of different programs share their keys)
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

  /**
   * The candidate's sheet: their snapshot once started, else the current program
   * (one with items). Started without a program stays without one.
   */
  function sheetOf(c: ExamCandidate): Sheet | null {
    if (c.program) return { parts: c.program, minPoints: c.min_points ?? 0 };
    if (c.started_at) return null;
    const program = data.programs.find(
      (p) => p.section === c.section && p.grade === c.grade && p.parts.length > 0
    );
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
    return !data.canGrade || !!c.result || c.status === 'withdrawn';
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

  /**
   * Freeze the rows on screen for a candidate, for the grade on screen. Without a
   * program only the start is recorded, which fixes grade and registration too.
   */
  async function startSheet(c: ExamCandidate, sheet: Sheet | null): Promise<boolean> {
    const startedAt = new Date().toISOString();
    const frozen = sheet ? { program: sheet.parts, min_points: sheet.minPoints } : {};
    const { data: rows, error } = await supabaseClient
      .from('exam_candidates')
      .update({ ...frozen, started_at: startedAt })
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
    patchCandidate(c.id, { ...frozen, started_at: startedAt });
    return true;
  }

  // One start per candidate, however many taps and notes arrive while it runs
  const pendingStarts = new Map<number, Promise<boolean>>();

  /**
   * Before the first score, note or result: start the sheet (freezing the
   * program, if the grade has one) and sign as examiner. From then on the
   * candidate stays as examined.
   */
  async function ensureStarted(c: ExamCandidate): Promise<boolean> {
    const now = live(c);
    const sheet = sheetFor(now);
    if (!now.started_at) {
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
  /** The group's open sheets I sign: handed back in one tap, e.g. after a mis-tap. */
  let leavable = $derived(
    group.filter((c) => !readonly(c) && c.examiners?.some((e) => e.user_id === me))
  );

  async function leave(list: ExamCandidate[]) {
    const { data: rows, error } = await supabaseClient
      .from('exam_examiners')
      .delete()
      .eq('user_id', me)
      .in(
        'candidate_id',
        list.map((c) => c.id)
      )
      .select('candidate_id');
    if (error) {
      console.error('Error handing candidates back:', error);
      toaster.error({ title: $_('page.exams.sheet.leaveError') });
      return;
    }
    const left = new Set((rows ?? []).map((r) => r.candidate_id));
    for (const c of list.filter((x) => left.has(x.id))) {
      patchCandidate(c.id, {
        examiners: (live(c).examiners ?? []).filter((e) => e.user_id !== me)
      });
    }
    // A sheet closed meanwhile keeps its examiners
    if (left.size < list.length) await changedMeanwhile();
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
    delete noteConflicts[noteKey(c.id, key)];
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
    if (!fresh || !!fresh.result === (result !== null) || fresh.status === 'withdrawn') {
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

{#if connection === 'lost'}
  <p class="flex items-start gap-2 text-sm text-surface-700-300 mb-3" role="status">
    <Fa icon={faCircleExclamation} class="text-warning-800-200 flex-none mt-1" />
    {$_('page.exams.sheet.notLive')}
  </p>
{/if}

{#snippet conflict(key: string)}
  {#if noteConflicts[key] !== undefined}
    <p class="text-xs text-warning-800-200 mt-1" role="status">
      {$_('page.exams.sheet.noteChanged', { values: { text: noteConflicts[key] || '–' } })}
    </p>
  {/if}
{/snippet}

{#if groups.length > 1}
  <div bind:this={chipRow} class="flex gap-2 overflow-x-auto pb-2" role="group">
    {#each groups as g (g[0].id)}
      <button
        class="btn btn-sm flex-none {g === group
          ? 'preset-filled-primary-500'
          : 'preset-tonal-surface'}"
        aria-pressed={g === group}
        onclick={() => showGroup(groups.indexOf(g))}
      >
        {names(g)}
      </button>
    {/each}
  </div>
{/if}

<div bind:this={sheetStart}></div>
<!-- Candidates with their running totals, kept in view while scrolling; with
     several sheets a horizontal swipe here switches between them -->
<div
  bind:this={stickyEl}
  role="region"
  aria-label={$_('page.exams.sheet.candidatesLabel')}
  class="sticky top-0 z-10 bg-surface-50-950 pt-1 pb-3 overflow-x-clip"
  style:touch-action={groups.length > 1 ? 'pan-y pinch-zoom' : undefined}
  ontouchstart={swipeStart}
  ontouchend={swipeEnd}
  ontouchcancel={swipeCancel}
>
  <!-- The drag moves the wrapper, the fly-in the cards inside: never the same element -->
  <div
    class={dragX ? '' : 'transition-transform duration-150 motion-reduce:transition-none'}
    style:transform={dragX ? `translateX(${dragX}px)` : undefined}
  >
    {#key group[0]?.id}
      <div
        class="grid gap-2 {pair ? 'grid-cols-2' : 'grid-cols-1'}"
        in:fly={{ x: slideFrom * 80, duration: reducedMotion || !slideFrom ? 0 : 200 }}
      >
        {#each sheets as { c, evaluation } (c.id)}
          {@const def = gradeDef(c.grade)}
          {@const state = candidateState(c)}
          <div class="card border border-surface-200-800 p-3 min-w-0">
            <!-- In a pair the chip takes its own line, so the name keeps its room -->
            <div
              class="flex items-center justify-between gap-x-2 gap-y-0.5 {pair ? 'flex-wrap' : ''}"
            >
              <span class="font-semibold truncate max-w-full">
                {c.member?.firstname}
                {c.member?.lastname}
              </span>
              {#if c.result || state === 'withdrawn'}<ExamStateChip {state} />{/if}
            </div>
            <p
              class="flex items-center gap-1.5 text-xs text-surface-600-400 min-w-0"
              title={programTitle(c)}
            >
              {#if def}<BeltStrip color={def.beltColor} color2={def.beltColor2} size="sm" />{/if}
              <span class="truncate">{c.grade}</span>
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
                  style:width="{evaluation.sides
                    ? (evaluation.scored / evaluation.sides) * 100
                    : 0}%"
                ></div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/key}
  </div>
  {#if groups.length > 1}
    <div class="flex justify-center mt-0.5 -mb-2.5">
      {#each groups as g, i (g[0].id)}
        <button
          type="button"
          class="p-2.5"
          title={names(g)}
          aria-label={names(g)}
          aria-current={g === group}
          onclick={() => showGroup(i)}
        >
          <span
            class="block size-2 rounded-full transition-colors motion-reduce:transition-none {g ===
            group
              ? 'bg-primary-500'
              : 'bg-surface-400-600'}"
          ></span>
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if joinable.length > 0 || leavable.length > 0}
  <!-- Optional (the first score signs the sheet anyway), hence tonal -->
  <div class="flex flex-wrap gap-2 mb-3">
    {#if joinable.length > 0}
      <button class="btn preset-tonal-primary" onclick={() => joinAsExaminer(joinable)}>
        <Fa icon={faUserPlus} />
        <span>{$_('page.exams.sheet.join')}</span>
      </button>
    {/if}
    {#if leavable.length > 0}
      <button class="btn preset-tonal-surface" onclick={() => leave(leavable)}>
        <Fa icon={faUserMinus} />
        <span>{$_('page.exams.sheet.leave')}</span>
      </button>
    {/if}
  </div>
{/if}

<!-- The legend helps whoever scores; a read-only sheet does without -->
{#if layout && !anyScored && sheets.some(({ c }) => !readonly(c))}
  <ScoreLegend class="mb-3" />
{/if}

{#if !layout}
  <div class="card border border-surface-200-800 p-4 mb-4">
    <p>{$_('page.exams.sheet.noProgram', { values: { grade: group[0]?.grade ?? '' } })}</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each layout.parts as part (part.key)}
      {@const partId = `${group[0]?.id}:${part.key}`}
      {@const open = !collapsed[partId]}
      <section class="card border border-surface-200-800 overflow-hidden">
        <button
          type="button"
          class="w-full flex items-start gap-3 p-3 text-left hover:bg-surface-100-900 transition-colors"
          aria-expanded={open}
          onclick={() => (collapsed[partId] = open)}
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
                  <div class="flex-1 min-w-0 leading-snug">
                    <span class="font-semibold">{item.name}</span>
                    {#if item.description}
                      <span class="text-sm text-surface-600-400">·&nbsp;{item.description}</span>
                    {/if}
                  </div>
                  {#if writable || hasNote}
                    <!-- A full 44 px target whose negative margins keep the title row
                         one line high; only the inner square shows hover / open -->
                    <button
                      type="button"
                      class="group btn-icon size-11 p-0 -my-2.5 -mr-1 flex-none self-start {hasNote
                        ? 'text-warning-800-200'
                        : 'text-surface-500'}"
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
                          data-note={noteKey(c.id, item.key)}
                          onchange={(e) => setNote(c, item.key, e.currentTarget)}
                        ></textarea>
                        {@render conflict(noteKey(c.id, item.key))}
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
            <!-- A missed minimum only shows on a sheet in grading, not on one not started -->
            {@const missed = !pe.met && (!readonly(c) || !!c.started_at)}
            <li
              class="flex items-center gap-2 py-1 tabular-nums"
              class:text-primary-600-400={missed}
            >
              <span class="flex-1 min-w-0 truncate">{part?.title}</span>
              {#if pe.minPoints !== null}
                <span class="flex-none inline-flex items-center gap-1 text-xs text-surface-600-400">
                  {$_('page.exams.sheet.min', { values: { points: pe.minPoints } })}
                  {#if pe.met || missed}
                    <Fa
                      icon={pe.met ? faCheck : faXmark}
                      size="xs"
                      class={pe.met ? 'text-success-600-400' : 'text-primary-600-400'}
                    />
                  {/if}
                </span>
              {/if}
              <span class="flex-none min-w-12 text-right" class:font-semibold={missed}>
                {pe.points}/{pe.max}
              </span>
            </li>
          {/each}
        </ul>
        <!-- The suggestion is for the examiners; a sheet not started reads as nothing yet -->
        {#if !c.result && (!readonly(c) || c.started_at)}
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
            data-note={noteKey(c.id, FEEDBACK_KEY)}
            onchange={(e) => setNote(c, FEEDBACK_KEY, e.currentTarget)}
          ></textarea>
          {@render conflict(noteKey(c.id, FEEDBACK_KEY))}
          <span class="block text-xs text-surface-600-400">
            {$_('page.exams.sheet.feedbackHint')}
          </span>
        </label>
      {/if}

      {#if data.canGrade && c.status !== 'withdrawn'}
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
