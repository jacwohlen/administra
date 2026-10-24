<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faCalendarDays,
    faChalkboardTeacher,
    faClipboardCheck,
    faClock,
    faEdit,
    faHourglassHalf,
    faLock,
    faLocationDot,
    faPeopleGroup,
    faPrint,
    faRulerHorizontal,
    faUserCheck,
    faUserPlus,
    faUsers,
    faXmark
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import ExamStateChip from '$lib/components/exams/ExamStateChip.svelte';
  import { candidateState, examinerName, groupCandidates } from '$lib/examUtils';
  import type { ExamCandidate } from '$lib/models';
  import { assignExaminer } from '../queries';
  import CandidateDialog from './CandidateDialog.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let me = $derived(data.session.user.id);
  // Candidates are kept by trainers and the TK, sheets by examiners
  let canManageCandidates = $derived(data.canWrite || data.canManageExams);
  let canSelect = $derived(canManageCandidates || data.canGrade);
  let filter = $state<'all' | 'mine'>('all');
  let selected = $state<number[]>([]);
  let dialog = $state<{ candidate: ExamCandidate | null } | null>(null);
  let assignOpen = $state(false);
  let assign = $state({ group_name: '', call_time: '', invite: true });
  let busy = $state(false);

  const today = dayjs().format('YYYY-MM-DD');
  let registrationOpen = $derived(
    (data.exam.registration_deadline ?? data.exam.date) >= today && data.exam.date >= today
  );

  let active = $derived(data.candidates.filter((c) => c.status !== 'withdrawn'));
  let withdrawn = $derived(data.candidates.filter((c) => c.status === 'withdrawn'));
  let mine = $derived(active.filter((c) => c.examiners?.some((e) => e.user_id === me)));
  let shown = $derived(filter === 'mine' ? mine : active);
  let groups = $derived(groupCandidates(shown));
  let passedCount = $derived(active.filter((c) => c.result === 'passed').length);
  let openCount = $derived(active.filter((c) => !c.result).length);

  let groupNames = $derived([
    ...new Set(data.candidates.map((c) => c.group_name?.trim()).filter(Boolean))
  ] as string[]);
  let trainerNames = $derived([
    ...new Set(data.candidates.map((c) => c.trainer?.trim()).filter(Boolean))
  ] as string[]);

  function gradeDef(grade: string) {
    return data.ladder.find((g) => g.grade === grade);
  }

  function programFor(grade: string) {
    return data.programs.find((p) => p.grade === grade);
  }

  function toggle(id: number) {
    selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  }

  async function refresh() {
    await invalidate('app:exam-candidates');
  }

  /** Take the selected open sheets on as examiner and open the sheet. */
  async function grade() {
    const picked = data.candidates.filter((c) => selected.includes(c.id));
    if (picked.length === 0) return;
    busy = true;
    // Finished sheets open read-only; nobody signs on to them afterwards
    const open = picked.filter((c) => !c.result && c.status !== 'withdrawn');
    const { error } = await assignExaminer(open, me, examinerName(data.userProfile));
    busy = false;
    if (error) {
      console.error('Error assigning examiner:', error);
      toaster.error({ title: $_('page.exams.assignError') });
      return;
    }
    await goto(`/dashboard/exams/${data.exam.id}/sheet?c=${selected.join(',')}`);
  }

  /** Call the selected candidates up: group, time and status in one go. */
  async function saveAssignment() {
    busy = true;
    const patch: Record<string, string | null> = {};
    if (assign.group_name.trim()) patch.group_name = assign.group_name.trim();
    if (assign.call_time) patch.call_time = assign.call_time;
    if (assign.invite) patch.status = 'invited';
    const { error } = await supabaseClient
      .from('exam_candidates')
      .update(patch)
      .in('id', selected)
      .neq('status', 'withdrawn');
    busy = false;
    if (error) {
      console.error('Error assigning group:', error);
      toaster.error({ title: $_('page.exams.candidate.saveError') });
      return;
    }
    assignOpen = false;
    selected = [];
    await refresh();
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
  <h1 class="flex-1 min-w-0 truncate">{data.exam.title}</h1>
  <div class="flex gap-2 flex-shrink-0">
    <a
      href="/dashboard/exams/{data.exam.id}/print"
      class="btn preset-tonal-surface"
      title={$_('page.exams.print.title')}
      aria-label={$_('page.exams.print.title')}
    >
      <Fa icon={faPrint} />
    </a>
    {#if data.canManageExams}
      <a
        href="/dashboard/exams/{data.exam.id}/edit"
        class="btn preset-tonal-surface"
        title={$_('page.exams.edit')}
        aria-label={$_('page.exams.edit')}
      >
        <Fa icon={faEdit} />
      </a>
    {/if}
  </div>
</div>

<div class="mb-6">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-surface-600-400">
    <span class="meta-item">
      <Fa icon={faCalendarDays} size="sm" />
      {dayjs(data.exam.date).format('DD.MM.YYYY')}
    </span>
    {#if data.exam.location}
      <span class="meta-item"><Fa icon={faLocationDot} size="sm" />{data.exam.location}</span>
    {/if}
    <span class="meta-item"><Fa icon={faUsers} size="sm" />{data.exam.section}</span>
    {#if data.exam.registration_deadline}
      <span class="meta-item" title={$_('page.exams.deadline')}>
        <Fa icon={faHourglassHalf} size="sm" />
        {$_('page.exams.deadline')}
        {dayjs(data.exam.registration_deadline).format('DD.MM.YYYY')}
      </span>
    {/if}
    <span
      class="chip text-xs {registrationOpen
        ? 'preset-tonal-success'
        : 'bg-surface-100-900 text-surface-600-400'}"
    >
      {registrationOpen ? $_('page.exams.registrationOpen') : $_('page.exams.registrationClosed')}
    </span>
    {#if data.exam.event_id}
      <a class="anchor" href="/dashboard/events/{data.exam.event_id}">{$_('page.exams.toEvent')}</a>
    {/if}
  </div>
  {#if data.exam.notes}
    <p class="text-sm text-surface-700-300 whitespace-pre-wrap mt-3">{data.exam.notes}</p>
  {/if}
</div>

<div class="grid grid-cols-3 gap-2 mb-6">
  <div class="card border border-surface-200-800 p-3 text-center">
    <div class="text-xl font-bold leading-tight tabular-nums text-primary-600-400">
      {active.length}
    </div>
    <div class="text-xs text-surface-600-400">{$_('page.exams.stats.candidates')}</div>
  </div>
  <div class="card border border-surface-200-800 p-3 text-center">
    <div class="text-xl font-bold leading-tight tabular-nums text-tertiary-600-400">
      {openCount}
    </div>
    <div class="text-xs text-surface-600-400">{$_('page.exams.stats.open')}</div>
  </div>
  <div class="card border border-surface-200-800 p-3 text-center">
    <div class="text-xl font-bold leading-tight tabular-nums text-success-600-400">
      {passedCount}
    </div>
    <div class="text-xs text-surface-600-400">{$_('page.exams.stats.passed')}</div>
  </div>
</div>

<div class="flex justify-between items-center gap-2 mb-3">
  <h3 class="mb-0!">{$_('page.exams.stats.candidates')}</h3>
  {#if canManageCandidates}
    <button
      class="btn preset-filled-primary-500 flex-shrink-0"
      onclick={() => (dialog = { candidate: null })}
    >
      <Fa icon={faUserPlus} />
      <span>{$_('page.exams.candidate.add')}</span>
    </button>
  {/if}
</div>

<!-- Only examiners have candidates of their own -->
{#if data.canGrade}
  <div class="flex rounded-lg overflow-hidden border border-surface-300-700 mb-3" role="group">
    <button
      class="btn flex-1 rounded-none {filter === 'all'
        ? 'preset-filled-primary-500'
        : 'preset-tonal-surface'}"
      aria-pressed={filter === 'all'}
      onclick={() => (filter = 'all')}
    >
      <Fa icon={faUsers} />
      <span>{$_('page.exams.filter.all')} ({active.length})</span>
    </button>
    <button
      class="btn flex-1 rounded-none {filter === 'mine'
        ? 'preset-filled-primary-500'
        : 'preset-tonal-surface'}"
      aria-pressed={filter === 'mine'}
      onclick={() => (filter = 'mine')}
    >
      <Fa icon={faUserCheck} />
      <span>{$_('page.exams.filter.mine')} ({mine.length})</span>
    </button>
  </div>
{/if}

{#if canSelect && active.length > 0}
  <p class="text-xs text-surface-600-400 mb-3">
    {!data.canGrade
      ? $_('page.exams.selectHintAssign')
      : !canManageCandidates
        ? $_('page.exams.selectHintGrade')
        : $_('page.exams.selectHint')}
  </p>
{/if}

{#if shown.length === 0}
  <p class="empty-state">
    {filter === 'mine' ? $_('page.exams.noMine') : $_('page.exams.noCandidates')}
  </p>
{:else}
  <div class="space-y-4 pb-20">
    {#each groups as group (group.name)}
      <section>
        <h3 class="flex items-center gap-3 mb-1.5 min-w-0">
          <span class="truncate">{group.name ?? $_('page.exams.noGroup')}</span>
          {#if group.candidates[0]?.call_time && group.name}
            <span class="meta-item flex-none text-sm text-surface-600-400">
              <Fa icon={faClock} size="sm" />
              {group.candidates[0].call_time}
            </span>
          {/if}
        </h3>
        <ul
          class="card border border-surface-200-800 divide-y divide-surface-200-800 overflow-hidden"
        >
          {#each group.candidates as c (c.id)}
            {@const def = gradeDef(c.grade)}
            {@const prog = programFor(c.grade)}
            <li class="flex items-center gap-3 px-3 py-2.5">
              {#if canSelect}
                <!-- 44 px tap area around the box, so a near miss selects instead of
                     opening the dialog; the negative margin keeps the row as it was -->
                <label class="flex flex-none -m-3 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    class="checkbox size-5"
                    checked={selected.includes(c.id)}
                    onchange={() => toggle(c.id)}
                    aria-label={$_('page.exams.select', {
                      values: { name: `${c.member?.firstname} ${c.member?.lastname}` }
                    })}
                  />
                </label>
              {/if}
              <!-- Trainers and the TK open the registration; examiners select the
                   candidate for grading; read-only accounts just read -->
              <button
                type="button"
                class="flex-1 min-w-0 text-left disabled:opacity-100 disabled:cursor-default"
                onclick={() =>
                  canManageCandidates ? (dialog = { candidate: c }) : canSelect && toggle(c.id)}
                disabled={!canSelect}
              >
                <span class="block font-semibold truncate leading-tight">
                  {c.member?.firstname}
                  {c.member?.lastname}
                  {#if c.member?.birthday}
                    <span class="text-sm font-normal text-surface-600-400">
                      · {c.member.birthday.slice(0, 4)}
                    </span>
                  {/if}
                </span>
                <span
                  class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-sm text-surface-600-400"
                >
                  <span class="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                    {#if def}<BeltStrip
                        color={def.beltColor}
                        color2={def.beltColor2}
                        size="sm"
                      />{/if}
                    <span class="truncate"
                      >{[c.grade, prog?.title].filter(Boolean).join(' · ')}</span
                    >
                  </span>
                  {#if c.call_time && !group.name}
                    <span class="meta-item"><Fa icon={faClock} size="sm" />{c.call_time}</span>
                  {/if}
                  {#if c.belt_length_cm}
                    <span class="meta-item" title={$_('page.exams.candidate.beltLength')}>
                      <Fa icon={faRulerHorizontal} size="sm" />{c.belt_length_cm} cm
                    </span>
                  {/if}
                  {#if c.trainer}
                    <span class="meta-item min-w-0" title={$_('page.exams.candidate.trainer')}>
                      <Fa icon={faChalkboardTeacher} size="sm" class="flex-none" />
                      <span class="truncate">{c.trainer}</span>
                    </span>
                  {/if}
                </span>
                {#if c.examiners && c.examiners.length > 0}
                  <span class="meta-item text-xs text-surface-600-400 mt-0.5 min-w-0">
                    <Fa icon={faUserCheck} size="xs" class="flex-none" />
                    <span class="truncate">
                      {$_('page.exams.examiners')}: {c.examiners.map((e) => e.name).join(', ')}
                    </span>
                  </span>
                {/if}
                {#if c.note}
                  <span class="block text-xs text-surface-600-400 truncate italic">{c.note}</span>
                {/if}
                {#if c.staff_note}
                  <span
                    class="meta-item text-xs text-surface-600-400 min-w-0"
                    title={$_('page.exams.candidate.staffNote')}
                  >
                    <Fa icon={faLock} size="xs" class="flex-none" />
                    <span class="truncate italic">{c.staff_note}</span>
                  </span>
                {/if}
              </button>
              <div class="flex flex-col items-end gap-1.5 flex-none">
                <span class="inline-flex items-center gap-1.5">
                  {#if c.result && c.total_points !== null}
                    <span class="text-xs tabular-nums text-surface-600-400">
                      {c.total_points}/{c.max_points}
                    </span>
                  {/if}
                  <ExamStateChip state={candidateState(c)} />
                </span>
                {#if c.started_at || c.result}
                  <a
                    class="btn preset-tonal-primary"
                    href="/dashboard/exams/{data.exam.id}/sheet?c={c.id}"
                    title={$_('page.exams.openSheet')}
                    aria-label="{$_('page.exams.openSheet')}: {c.member?.firstname}"
                  >
                    <Fa icon={faClipboardCheck} />
                    <span class="hidden sm:inline">{$_('page.exams.openSheet')}</span>
                  </a>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}

{#if withdrawn.length > 0}
  <details class="mt-2 mb-20">
    <summary class="cursor-pointer text-sm text-surface-600-400 py-2">
      {$_('page.exams.withdrawn', { values: { count: withdrawn.length } })}
    </summary>
    <ul class="card border border-surface-200-800 divide-y divide-surface-200-800 text-sm">
      {#each withdrawn as c (c.id)}
        <li class="flex items-center justify-between gap-2 px-3 py-1">
          <span class="truncate text-surface-600-400">
            {c.member?.firstname}
            {c.member?.lastname} · {c.grade}
          </span>
          {#if canManageCandidates}
            <button
              class="btn btn-sm preset-tonal-surface flex-none"
              title={$_('button.edit')}
              aria-label="{$_('button.edit')}: {c.member?.firstname}"
              onclick={() => (dialog = { candidate: c })}
            >
              <Fa icon={faEdit} />
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </details>
{/if}

{#if selected.length > 0}
  <div class="fixed bottom-0 inset-x-0 z-40 bg-surface-100-900 border-t border-surface-300-700 p-3">
    <div class="max-w-4xl mx-auto flex items-center gap-2">
      <button
        class="btn-icon size-11 p-0 flex-none hover:bg-surface-200-800"
        title={$_('button.cancel')}
        aria-label={$_('button.cancel')}
        onclick={() => (selected = [])}
      >
        <Fa icon={faXmark} />
      </button>
      <span class="flex-1 min-w-0 truncate text-sm tabular-nums">
        {$_('page.exams.selectedShort', { values: { count: selected.length } })}
      </span>
      {#if canManageCandidates}
        <button
          class="btn preset-tonal-primary flex-none"
          title={$_('page.exams.assignGroup')}
          aria-label={$_('page.exams.assignGroup')}
          onclick={() => (assignOpen = true)}
          disabled={busy}
        >
          <Fa icon={faPeopleGroup} />
          <span class="hidden sm:inline">{$_('page.exams.assignGroup')}</span>
        </button>
      {/if}
      {#if data.canGrade}
        <button class="btn preset-filled-primary-500 flex-none" onclick={grade} disabled={busy}>
          <Fa icon={faClipboardCheck} />
          <span>{$_('page.exams.grade')}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

{#if dialog}
  <CandidateDialog
    exam={data.exam}
    ladder={data.ladder}
    candidate={dialog.candidate}
    existingMemberIds={data.candidates.map((c) => c.member_id)}
    programGrades={data.programs.map((p) => p.grade)}
    groups={groupNames}
    trainers={trainerNames}
    canManageExams={data.canManageExams}
    onclose={() => (dialog = null)}
    onsaved={async () => {
      dialog = null;
      await refresh();
    }}
  />
{/if}

{#if assignOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (assignOpen = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') assignOpen = false;
    }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('page.exams.assignGroup')}</h3>
      <p class="text-sm text-surface-600-400 mb-3">
        {$_('page.exams.selected', { values: { count: selected.length } })}
      </p>
      <form
        class="space-y-3"
        onsubmit={(e) => {
          e.preventDefault();
          saveAssignment();
        }}
      >
        <label class="label">
          <span>{$_('page.exams.candidate.group')}</span>
          <input
            class="input"
            type="text"
            list="assign-groups"
            bind:value={assign.group_name}
            placeholder={$_('page.exams.candidate.groupPlaceholder')}
          />
          <datalist id="assign-groups">
            {#each groupNames as g (g)}<option value={g}></option>{/each}
          </datalist>
        </label>
        <label class="label">
          <span>{$_('page.exams.candidate.callTime')}</span>
          <input class="input" type="time" bind:value={assign.call_time} />
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" class="checkbox" bind:checked={assign.invite} />
          <span>{$_('page.exams.markInvited')}</span>
        </label>
        <footer class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            class="btn preset-tonal-surface"
            onclick={() => (assignOpen = false)}
          >
            {$_('button.cancel')}
          </button>
          <button type="submit" class="btn preset-filled-primary-500" disabled={busy}>
            {$_('button.save')}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}
