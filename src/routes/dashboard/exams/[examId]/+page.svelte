<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faCalendarDays,
    faClipboardCheck,
    faClock,
    faEdit,
    faLocationDot,
    faPeopleGroup,
    faPrint,
    faUserPlus,
    faUsers
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import { candidateState, examinerName, groupCandidates } from '$lib/examUtils';
  import type { ExamCandidate } from '$lib/models';
  import { assignExaminer } from '../queries';
  import CandidateDialog from './CandidateDialog.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let me = $derived(data.session.user.id);
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

  function stateClass(state: string): string {
    if (state === 'passed') return 'preset-filled-success-500';
    if (state === 'failed') return 'preset-filled-error-500';
    if (state === 'grading') return 'preset-filled-warning-500';
    if (state === 'invited') return 'preset-tonal-primary';
    return 'preset-tonal-surface';
  }

  async function refresh() {
    await invalidate('app:exam-candidates');
  }

  /** Take the selected candidates on as examiner and open their sheet. */
  async function grade() {
    const picked = data.candidates.filter((c) => selected.includes(c.id));
    if (picked.length === 0) return;
    busy = true;
    const { error } = await assignExaminer(picked, me, examinerName(data.userProfile));
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
  <a href="/dashboard/exams" class="btn preset-tonal-surface flex-shrink-0">
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{data.exam.title}</h1>
  <a
    href="/dashboard/exams/{data.exam.id}/print"
    class="btn preset-tonal-surface"
    title={$_('page.exams.print.title')}
    aria-label={$_('page.exams.print.title')}
  >
    <Fa icon={faPrint} />
  </a>
  {#if data.canWrite}
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

<div class="flex flex-wrap gap-3 text-sm text-surface-600-400 mb-3">
  <span class="meta-item">
    <Fa icon={faCalendarDays} size="sm" />
    {dayjs(data.exam.date).format('DD.MM.YYYY')}
  </span>
  {#if data.exam.location}
    <span class="meta-item"><Fa icon={faLocationDot} size="sm" />{data.exam.location}</span>
  {/if}
  <span class="meta-item"><Fa icon={faUsers} size="sm" />{data.exam.section}</span>
  {#if data.exam.registration_deadline}
    <span>
      {$_('page.exams.deadline')}: {dayjs(data.exam.registration_deadline).format('DD.MM.YYYY')}
    </span>
  {/if}
  <span class="chip text-xs {registrationOpen ? 'preset-tonal-success' : 'preset-tonal-surface'}">
    {registrationOpen ? $_('page.exams.registrationOpen') : $_('page.exams.registrationClosed')}
  </span>
  {#if data.exam.event_id}
    <a class="anchor" href="/dashboard/events/{data.exam.event_id}">{$_('page.exams.toEvent')}</a>
  {/if}
</div>
{#if data.exam.notes}
  <p class="text-sm whitespace-pre-wrap mb-3">{data.exam.notes}</p>
{/if}

<div class="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
  <div class="card p-3 text-center">
    <div class="sm:text-xl font-bold text-primary-600-400">{active.length}</div>
    <div class="text-xs text-surface-600-400">{$_('page.exams.stats.candidates')}</div>
  </div>
  <div class="card p-3 text-center">
    <div class="sm:text-xl font-bold text-warning-600-400">{openCount}</div>
    <div class="text-xs text-surface-600-400">{$_('page.exams.stats.open')}</div>
  </div>
  <div class="card p-3 text-center">
    <div class="sm:text-xl font-bold text-success-600-400">{passedCount}</div>
    <div class="text-xs text-surface-600-400">{$_('page.exams.stats.passed')}</div>
  </div>
</div>

<div class="flex flex-wrap items-center justify-between gap-2 mb-3">
  <div class="flex rounded-lg overflow-hidden border border-surface-300-700" role="group">
    <button
      class="px-3 min-h-[40px] text-sm {filter === 'all'
        ? 'preset-filled-primary-500'
        : 'preset-tonal-surface'}"
      onclick={() => (filter = 'all')}
    >
      {$_('page.exams.filter.all')} ({active.length})
    </button>
    <button
      class="px-3 min-h-[40px] text-sm {filter === 'mine'
        ? 'preset-filled-primary-500'
        : 'preset-tonal-surface'}"
      onclick={() => (filter = 'mine')}
    >
      {$_('page.exams.filter.mine')} ({mine.length})
    </button>
  </div>
  {#if data.canWrite}
    <button class="btn preset-filled-primary-500" onclick={() => (dialog = { candidate: null })}>
      <Fa icon={faUserPlus} />
      <span>{$_('page.exams.candidate.add')}</span>
    </button>
  {/if}
</div>

{#if data.canWrite && active.length > 0}
  <p class="text-xs text-surface-600-400 mb-2">{$_('page.exams.selectHint')}</p>
{/if}

{#if shown.length === 0}
  <p class="empty-state">
    {filter === 'mine' ? $_('page.exams.noMine') : $_('page.exams.noCandidates')}
  </p>
{:else}
  <div class="space-y-4 pb-20">
    {#each groups as group (group.name)}
      <section>
        <h3 class="flex items-center gap-2 text-base!">
          <Fa icon={faPeopleGroup} class="text-surface-500" />
          {group.name ?? $_('page.exams.noGroup')}
          {#if group.candidates[0]?.call_time && group.name}
            <span class="text-sm font-normal text-surface-600-400">
              · {group.candidates[0].call_time}
            </span>
          {/if}
        </h3>
        <ul class="card border border-surface-200-800 divide-y divide-surface-200-800">
          {#each group.candidates as c (c.id)}
            {@const state = candidateState(c)}
            {@const def = gradeDef(c.grade)}
            {@const prog = programFor(c.grade)}
            <li class="flex items-center gap-3 px-3 py-2">
              {#if data.canWrite}
                <input
                  type="checkbox"
                  class="checkbox size-5 flex-none"
                  checked={selected.includes(c.id)}
                  onchange={() => toggle(c.id)}
                  aria-label={$_('page.exams.select', {
                    values: { name: `${c.member?.firstname} ${c.member?.lastname}` }
                  })}
                />
              {/if}
              <button
                type="button"
                class="flex-1 min-w-0 text-left"
                onclick={() => (data.canWrite ? (dialog = { candidate: c }) : null)}
                disabled={!data.canWrite}
              >
                <div class="font-semibold truncate">
                  {c.member?.firstname}
                  {c.member?.lastname}
                  {#if c.member?.birthday}
                    <span class="text-xs font-normal text-surface-600-400">
                      ({c.member.birthday.slice(0, 4)})
                    </span>
                  {/if}
                </div>
                <div
                  class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-surface-600-400"
                >
                  <span class="inline-flex items-center gap-1">
                    {#if def}<BeltStrip
                        color={def.beltColor}
                        color2={def.beltColor2}
                        size="sm"
                      />{/if}
                    {[c.grade, prog?.title].filter(Boolean).join(' · ')}
                  </span>
                  {#if c.call_time && !group.name}
                    <span class="meta-item"><Fa icon={faClock} size="xs" />{c.call_time}</span>
                  {/if}
                  {#if c.belt_length_cm}<span>{c.belt_length_cm} cm</span>{/if}
                  {#if c.trainer}<span class="truncate">· {c.trainer}</span>{/if}
                </div>
                {#if c.examiners && c.examiners.length > 0}
                  <div class="text-xs text-surface-600-400 truncate">
                    {$_('page.exams.examiners')}: {c.examiners.map((e) => e.name).join(', ')}
                  </div>
                {/if}
                {#if c.note}
                  <div class="text-xs text-surface-600-400 truncate italic">{c.note}</div>
                {/if}
              </button>
              <div class="flex flex-col items-end gap-1 flex-none">
                <span class="chip text-xs {stateClass(state)}">
                  {$_('page.exams.state.' + state)}
                </span>
                {#if c.result && c.total_points !== null}
                  <span class="text-xs tabular-nums">{c.total_points}/{c.max_points}</span>
                {/if}
                {#if c.started_at || c.result}
                  <a class="text-xs anchor" href="/dashboard/exams/{data.exam.id}/sheet?c={c.id}">
                    {$_('page.exams.openSheet')}
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
    <summary class="cursor-pointer text-sm text-surface-600-400">
      {$_('page.exams.withdrawn', { values: { count: withdrawn.length } })}
    </summary>
    <ul class="mt-2 space-y-1 text-sm">
      {#each withdrawn as c (c.id)}
        <li class="flex items-center justify-between gap-2">
          <span>{c.member?.firstname} {c.member?.lastname} · {c.grade}</span>
          {#if data.canWrite}
            <button class="anchor text-xs" onclick={() => (dialog = { candidate: c })}>
              {$_('button.edit')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </details>
{/if}

{#if selected.length > 0}
  <div class="fixed bottom-0 inset-x-0 z-40 bg-surface-100-900 border-t border-surface-300-700 p-3">
    <div class="max-w-4xl mx-auto flex flex-wrap items-center gap-2">
      <span class="text-sm flex-1">
        {$_('page.exams.selected', { values: { count: selected.length } })}
      </span>
      <button class="btn preset-tonal-surface" onclick={() => (selected = [])}>
        {$_('button.cancel')}
      </button>
      <button class="btn preset-tonal-primary" onclick={() => (assignOpen = true)} disabled={busy}>
        <Fa icon={faPeopleGroup} />
        <span>{$_('page.exams.assignGroup')}</span>
      </button>
      <button class="btn preset-filled-primary-500" onclick={grade} disabled={busy}>
        <Fa icon={faClipboardCheck} />
        <span>{$_('page.exams.grade')}</span>
      </button>
    </div>
  </div>
{/if}

{#if dialog}
  <CandidateDialog
    exam={data.exam}
    ladder={data.ladder}
    candidate={dialog.candidate}
    existingMemberIds={data.candidates.map((c) => c.member_id)}
    groups={groupNames}
    trainers={trainerNames}
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
