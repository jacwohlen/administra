<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faBookOpen,
    faCalendarDays,
    faChevronRight,
    faEdit,
    faLocationDot,
    faSpinner,
    faUserPlus
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import ExamStateChip from '$lib/components/exams/ExamStateChip.svelte';
  import { candidateState, registrableGrades, suggestedGrade } from '$lib/examUtils';
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

  /** The registration for an exam day, also a withdrawn one (only trainers revive those). */
  function registrationFor(exam: Exam): MemberRegistration | undefined {
    return exams.registrations.find((r) => r.exam_id === exam.id);
  }

  function hasProgram(section: string) {
    return (grade: string) => !!programFor(section, grade);
  }

  function isOpen(exam: Exam): boolean {
    return (exam.registration_deadline ?? exam.date) >= today && exam.date >= today;
  }

  /**
   * The program for the next belt, to prepare with even before an exam is
   * announced: the first of the member's sections that has one.
   */
  let nextProgram = $derived.by(() => {
    const sections = [...new Set([...currentGrades.map((g) => g.section), ...member.sections])];
    for (const section of sections) {
      const next = suggestedGrade(
        ladders.get(section) ?? [],
        currentGrade(section),
        hasProgram(section)
      );
      const program = next ? programFor(section, next.grade) : undefined;
      if (program) return program;
    }
    return undefined;
  });

  function openForm(exam: Exam, reg?: MemberRegistration) {
    const suggested = suggestedGrade(
      ladders.get(exam.section) ?? [],
      currentGrade(exam.section),
      hasProgram(exam.section)
    );
    form = {
      grade: reg?.grade ?? suggested?.grade ?? '',
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
  <section class="card border border-surface-200-800 p-4">
    <h3>{$_('page.club.exams.title')}</h3>

    <div class="divide-y divide-surface-300-700">
      {#each exams.upcoming as exam (exam.id)}
        {@const reg = registrationFor(exam)}
        {@const open = isOpen(exam)}
        <div class="py-3 first:pt-0 space-y-2">
          <div>
            <p class="font-semibold">{exam.title}</p>
            <p class="flex flex-wrap items-center gap-x-3 text-sm text-surface-600-400">
              <span class="meta-item">
                <Fa icon={faCalendarDays} size="sm" />
                {dayjs(exam.date).format('DD.MM.YYYY')}
              </span>
              {#if exam.location}
                <span class="meta-item"><Fa icon={faLocationDot} size="sm" />{exam.location}</span>
              {/if}
            </p>
            <p class="text-xs text-surface-600-400 mt-0.5">
              {open
                ? $_('page.club.exams.deadline', {
                    values: {
                      date: dayjs(exam.registration_deadline ?? exam.date).format('DD.MM.YYYY')
                    }
                  })
                : $_('page.club.exams.closed')}
            </p>
          </div>
          {#if exam.notes}
            <p class="text-sm text-surface-700-300 whitespace-pre-wrap">{exam.notes}</p>
          {/if}

          {#if reg && formFor !== exam.id}
            {@const def = gradeDef(reg.section, reg.grade)}
            {@const program = programFor(reg.section, reg.grade)}
            <div class="rounded-container bg-surface-100-900 p-3 space-y-2">
              <div class="flex items-center gap-2">
                {#if def}<BeltStrip color={def.beltColor} color2={def.beltColor2} />{/if}
                <span class="font-semibold">{reg.grade}</span>
                <span class="ml-auto"><ExamStateChip state={candidateState(reg)} /></span>
              </div>
              <p class="text-sm">
                {#if reg.status === 'withdrawn'}
                  {$_('page.club.exams.askTrainer')}
                {:else if reg.status === 'invited' && (reg.group_name || reg.call_time)}
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
            </div>
            <div class="flex flex-wrap gap-2">
              {#if program}
                <a href="/club/programs/{program.id}" class="btn preset-tonal-primary text-sm">
                  <Fa icon={faBookOpen} />
                  <span>{$_('page.club.exams.program')}</span>
                </a>
              {/if}
              {#if open && reg.status === 'registered' && !reg.started_at}
                <button
                  class="btn preset-tonal-surface text-sm"
                  onclick={() => openForm(exam, reg)}
                >
                  <Fa icon={faEdit} />
                  <span>{$_('button.edit')}</span>
                </button>
              {/if}
              {#if reg.status !== 'withdrawn' && !reg.started_at && !reg.result}
                <button
                  class="btn preset-tonal-error text-sm"
                  onclick={() => (confirmWithdraw = reg)}
                  disabled={busy}
                >
                  {$_('page.club.exams.withdraw')}
                </button>
              {/if}
            </div>
          {:else if formFor === exam.id}
            <form
              class="space-y-3"
              onsubmit={(e) => {
                e.preventDefault();
                register(exam);
              }}
            >
              <label class="label">
                <span>{$_('page.club.exams.grade')}</span>
                <select class="select" bind:value={form.grade} required>
                  {#each options(exam) as g (g.grade)}
                    <option value={g.grade}>{g.grade}</option>
                  {/each}
                </select>
              </label>
              <label class="label">
                <span>{$_('page.club.exams.beltLength')}</span>
                <input
                  class="input"
                  type="number"
                  min="100"
                  max="400"
                  step="10"
                  bind:value={form.belt}
                />
                <span class="text-xs text-surface-600-400">
                  {$_('page.club.exams.beltLengthHint')}
                </span>
              </label>
              <label class="label">
                <span>{$_('page.club.exams.note')}</span>
                <input class="input" type="text" maxlength="500" bind:value={form.note} />
              </label>
              <footer class="flex justify-end gap-2">
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
                  <Fa icon={busy ? faSpinner : faUserPlus} spin={busy} />
                  <span>{$_('page.club.exams.register')}</span>
                </button>
              </footer>
            </form>
          {:else if open && options(exam).length > 0}
            <button class="btn preset-filled-primary-500" onclick={() => openForm(exam)}>
              <Fa icon={faUserPlus} />
              <span
                >{$_('page.club.exams.registerFor', { values: { name: member.firstname } })}</span
              >
            </button>
          {:else if !open}
            <p class="text-sm text-surface-600-400">{$_('page.club.exams.askTrainer')}</p>
          {/if}
        </div>
      {:else}
        <p class="text-surface-600-400 pb-3">{$_('page.club.exams.noneAnnounced')}</p>
      {/each}
    </div>

    {#if nextProgram && exams.upcoming.length === 0}
      <a href="/club/programs/{nextProgram.id}" class="btn preset-tonal-primary text-sm">
        <Fa icon={faBookOpen} />
        <span>
          {$_('page.club.exams.nextProgram', {
            values: { grade: nextProgram.grade, title: nextProgram.title }
          })}
        </span>
      </a>
    {/if}

    {#if results.length > 0}
      <p class="text-sm font-medium text-surface-600-400 mt-4 mb-1.5">
        {$_('page.club.exams.results')}
      </p>
      <ul class="divide-y divide-surface-300-700">
        {#each results as r (r.id)}
          {@const def = gradeDef(r.section, r.grade)}
          <li>
            <a
              href="/club/exams/{r.id}"
              class="flex items-center gap-2 py-2 px-2 -mx-2 rounded text-sm hover:bg-surface-100-900 transition-colors"
            >
              {#if def}<BeltStrip color={def.beltColor} color2={def.beltColor2} size="sm" />{/if}
              <span class="font-semibold">{r.grade}</span>
              <span class="text-surface-600-400 truncate">
                {r.exam ? dayjs(r.exam.date).format('DD.MM.YYYY') : ''}
              </span>
              <span class="ml-auto inline-flex items-center gap-1.5 flex-none">
                {#if r.total_points !== null}
                  <span class="text-xs tabular-nums text-surface-600-400">
                    {r.total_points}/{r.max_points}
                  </span>
                {/if}
                <ExamStateChip state={candidateState(r)} />
              </span>
              <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
            </a>
          </li>
        {/each}
      </ul>
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
