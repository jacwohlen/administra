<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faAward,
    faBookOpen,
    faCalendarDays,
    faChevronRight,
    faSpinner
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import { registrableGrades } from '$lib/examUtils';
  import { gradesBySection } from '$lib/gradeUtils';
  import type { DirectoryMember, Exam, GradeDefinition, MemberCurrentGrade } from '$lib/models';
  import type { MemberExams, MemberRegistration } from './memberExams';

  // Q-Prüfung on the member's own profile: register for the next exam day
  // (replacing the sheet in the dojo), see the call-up, read the result sheet
  // and the program to prepare with.
  let {
    member,
    exams,
    currentGrades,
    gradeDefinitions
  }: {
    member: DirectoryMember;
    exams: MemberExams;
    currentGrades: MemberCurrentGrade[];
    gradeDefinitions: GradeDefinition[];
  } = $props();

  const today = dayjs().format('YYYY-MM-DD');

  let ladders = $derived(gradesBySection(gradeDefinitions));
  let formFor = $state<number | null>(null);
  let form = $state({ grade: '', belt: null as number | null, note: '' });
  let busy = $state(false);
  let confirmWithdraw = $state<MemberRegistration | null>(null);

  let results = $derived(exams.registrations.filter((r) => r.result));

  function currentGrade(section: string): string | undefined {
    return currentGrades.find((g) => g.section === section)?.grade;
  }

  function options(exam: Exam): GradeDefinition[] {
    return registrableGrades(ladders.get(exam.section) ?? [], currentGrade(exam.section));
  }

  function gradeDef(section: string, grade: string): GradeDefinition | undefined {
    return gradeDefinitions.find((g) => g.section === section && g.grade === grade);
  }

  function programFor(section: string, grade: string) {
    return exams.programs.find((p) => p.section === section && p.grade === grade);
  }

  function registrationFor(exam: Exam): MemberRegistration | undefined {
    return exams.registrations.find((r) => r.exam_id === exam.id && r.status !== 'withdrawn');
  }

  function isOpen(exam: Exam): boolean {
    return (exam.registration_deadline ?? exam.date) >= today && exam.date >= today;
  }

  /** The program for the next belt, to prepare with even before an exam is announced. */
  let nextProgram = $derived.by(() => {
    const section = currentGrades[0]?.section ?? member.sections[0];
    if (!section) return undefined;
    const next = registrableGrades(ladders.get(section) ?? [], currentGrade(section))[0];
    return next ? programFor(section, next.grade) : undefined;
  });

  function openForm(exam: Exam, reg?: MemberRegistration) {
    form = {
      grade: reg?.grade ?? options(exam)[0]?.grade ?? '',
      belt: reg?.belt_length_cm ?? null,
      note: reg?.note ?? ''
    };
    formFor = exam.id;
  }

  async function register(exam: Exam) {
    if (!form.grade) return;
    busy = true;
    const { error } = await supabaseClient.rpc('register_for_exam', {
      p_exam_id: exam.id,
      p_member_id: member.id,
      p_grade: form.grade,
      p_belt_length_cm: form.belt || null,
      p_note: form.note.trim() || null
    });
    busy = false;
    if (error) {
      console.error('Error registering for exam:', error);
      toaster.error({ title: $_('page.club.exams.registerError') });
      return;
    }
    formFor = null;
    toaster.success({ title: $_('page.club.exams.registered') });
    await invalidate('app:club-exams');
  }

  async function withdraw(reg: MemberRegistration) {
    busy = true;
    const { error } = await supabaseClient.rpc('withdraw_exam_registration', {
      p_candidate_id: reg.id
    });
    busy = false;
    confirmWithdraw = null;
    if (error) {
      console.error('Error withdrawing exam registration:', error);
      toaster.error({ title: $_('page.club.exams.withdrawError') });
      return;
    }
    toaster.success({ title: $_('page.club.exams.withdrawn') });
    await invalidate('app:club-exams');
  }
</script>

{#if exams.upcoming.length > 0 || results.length > 0 || nextProgram}
  <section class="card border border-surface-200-800 p-4 space-y-3">
    <h3 class="flex items-center gap-2 mb-0!">
      <Fa icon={faAward} class="text-primary-500" />
      {$_('page.club.exams.title')}
    </h3>

    {#each exams.upcoming as exam (exam.id)}
      {@const reg = registrationFor(exam)}
      {@const open = isOpen(exam)}
      <div class="rounded-lg border border-surface-200-800 p-3 space-y-2">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3">
          <span class="font-semibold">{exam.title}</span>
          <span class="meta-item text-sm text-surface-600-400">
            <Fa icon={faCalendarDays} size="sm" />
            {dayjs(exam.date).format('DD.MM.YYYY')}
          </span>
        </div>
        <p class="text-sm text-surface-600-400">
          {#if exam.location}{exam.location} ·{/if}
          {open
            ? $_('page.club.exams.deadline', {
                values: {
                  date: dayjs(exam.registration_deadline ?? exam.date).format('DD.MM.YYYY')
                }
              })
            : $_('page.club.exams.closed')}
        </p>
        {#if exam.notes}
          <p class="text-sm whitespace-pre-wrap">{exam.notes}</p>
        {/if}

        {#if reg && formFor !== exam.id}
          {@const def = gradeDef(reg.section, reg.grade)}
          {@const program = programFor(reg.section, reg.grade)}
          <div class="flex items-center gap-2">
            {#if def}<BeltStrip color={def.beltColor} color2={def.beltColor2} />{/if}
            <span class="font-medium">{reg.grade}</span>
            <span class="chip text-xs preset-tonal-success">
              {$_('page.exams.state.' + (reg.started_at ? 'grading' : reg.status))}
            </span>
          </div>
          <p class="text-sm">
            {#if reg.status === 'invited' && (reg.group_name || reg.call_time)}
              {$_('page.club.exams.callUp', {
                values: {
                  group: reg.group_name ?? '–',
                  time: reg.call_time ?? '–'
                }
              })}
            {:else}
              {$_('page.club.exams.waitForCallUp')}
            {/if}
          </p>
          <div class="flex flex-wrap gap-2">
            {#if program}
              <a href="/club/programs/{program.id}" class="btn btn-sm preset-tonal-primary">
                <Fa icon={faBookOpen} />
                <span>{$_('page.club.exams.program')}</span>
              </a>
            {/if}
            {#if open && reg.status === 'registered' && !reg.started_at}
              <button class="btn btn-sm preset-tonal-surface" onclick={() => openForm(exam, reg)}>
                {$_('button.edit')}
              </button>
            {/if}
            {#if !reg.started_at && !reg.result}
              <button
                class="btn btn-sm preset-tonal-error"
                onclick={() => (confirmWithdraw = reg)}
                disabled={busy}
              >
                {$_('page.club.exams.withdraw')}
              </button>
            {/if}
          </div>
        {:else if formFor === exam.id}
          <form
            class="space-y-2"
            onsubmit={(e) => {
              e.preventDefault();
              register(exam);
            }}
          >
            <label class="label">
              <span class="text-sm">{$_('page.club.exams.grade')}</span>
              <select class="select" bind:value={form.grade} required>
                {#each options(exam) as g (g.grade)}
                  <option value={g.grade}>{g.grade}</option>
                {/each}
              </select>
            </label>
            <label class="label">
              <span class="text-sm">{$_('page.club.exams.beltLength')}</span>
              <input
                class="input"
                type="number"
                min="100"
                max="400"
                step="10"
                bind:value={form.belt}
              />
              <span class="text-xs text-surface-600-400"
                >{$_('page.club.exams.beltLengthHint')}</span
              >
            </label>
            <label class="label">
              <span class="text-sm">{$_('page.club.exams.note')}</span>
              <input class="input" type="text" maxlength="500" bind:value={form.note} />
            </label>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="btn preset-tonal-surface"
                onclick={() => (formFor = null)}
              >
                {$_('button.cancel')}
              </button>
              <button
                type="submit"
                class="btn preset-filled-primary-500"
                disabled={busy || !form.grade}
              >
                {#if busy}<Fa icon={faSpinner} spin />{/if}
                <span>{$_('page.club.exams.register')}</span>
              </button>
            </div>
          </form>
        {:else if open && options(exam).length > 0}
          <button class="btn preset-filled-primary-500" onclick={() => openForm(exam)}>
            {$_('page.club.exams.registerFor', { values: { name: member.firstname } })}
          </button>
        {:else if !open}
          <p class="text-sm text-surface-600-400">{$_('page.club.exams.askTrainer')}</p>
        {/if}
      </div>
    {:else}
      <p class="text-sm text-surface-600-400">{$_('page.club.exams.noneAnnounced')}</p>
    {/each}

    {#if nextProgram && exams.upcoming.length === 0}
      <a href="/club/programs/{nextProgram.id}" class="btn preset-tonal-primary">
        <Fa icon={faBookOpen} />
        <span>
          {$_('page.club.exams.nextProgram', {
            values: { grade: nextProgram.grade, title: nextProgram.title }
          })}
        </span>
      </a>
    {/if}

    {#if results.length > 0}
      <div>
        <p class="text-sm font-medium text-surface-600-400 mb-1">{$_('page.club.exams.results')}</p>
        <ul class="divide-y divide-surface-200-800">
          {#each results as r (r.id)}
            {@const def = gradeDef(r.section, r.grade)}
            <li>
              <a
                href="/club/exams/{r.id}"
                class="flex items-center gap-2 py-2 hover:bg-surface-100-900 rounded"
              >
                {#if def}<BeltStrip color={def.beltColor} color2={def.beltColor2} size="sm" />{/if}
                <span class="font-medium">{r.grade}</span>
                <span class="text-sm text-surface-600-400">
                  {r.exam ? dayjs(r.exam.date).format('DD.MM.YYYY') : ''}
                </span>
                <span
                  class="chip text-xs ml-auto {r.result === 'passed'
                    ? 'preset-filled-success-500'
                    : 'preset-tonal-surface'}"
                >
                  {$_('page.exams.state.' + r.result)}
                </span>
                {#if r.total_points !== null}
                  <span class="text-xs tabular-nums">{r.total_points}/{r.max_points}</span>
                {/if}
                <Fa icon={faChevronRight} class="text-surface-400-600" />
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}

{#if confirmWithdraw}
  {@const reg = confirmWithdraw}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (confirmWithdraw = null)}
    onkeydown={(e) => {
      if (e.key === 'Escape') confirmWithdraw = null;
    }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('dialog.confirm.title')}</h3>
      <p class="mb-4">
        {$_('page.club.exams.withdrawConfirm', {
          values: { name: member.firstname, title: reg.exam?.title ?? '' }
        })}
      </p>
      <div class="flex justify-end gap-2">
        <button class="btn preset-tonal-surface" onclick={() => (confirmWithdraw = null)}>
          {$_('button.cancel')}
        </button>
        <button class="btn preset-filled-error-500" onclick={() => withdraw(reg)} disabled={busy}>
          {$_('page.club.exams.withdraw')}
        </button>
      </div>
    </div>
  </div>
{/if}
