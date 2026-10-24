<script lang="ts">
  import { modalDialog } from '$lib/modalDialog';
  import { invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
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
  import { registrableGrades, suggestedGrade, type CandidateState } from '$lib/examUtils';
  import { gradesBySection } from '$lib/gradeUtils';
  import type { DirectoryMember, Exam, GradeDefinition, MemberCurrentGrade } from '$lib/models';
  import type { MemberExams, MemberRegistration } from './memberExams';

  // Q-Prüfung on the member's own profile: register for the next exam day
  // (replacing the sheet in the dojo) and see the call-up. Sheets, points and
  // programs stay with the club; a passed exam shows up as the new grade.
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
  let confirmWithdraw = $state<{ reg: MemberRegistration; exam: Exam } | null>(null);

  function currentGrade(section: string): string | undefined {
    return currentGrades.find((g) => g.section === section)?.grade;
  }

  function options(exam: Exam): GradeDefinition[] {
    return registrableGrades(ladders.get(exam.section) ?? [], currentGrade(exam.section));
  }

  function gradeDef(section: string, grade: string): GradeDefinition | undefined {
    return gradeDefinitions.find((g) => g.section === section && g.grade === grade);
  }

  /** The registration for an exam day, also a withdrawn one (only trainers revive those). */
  function registrationFor(exam: Exam): MemberRegistration | undefined {
    return exams.registrations.find((r) => r.exam_id === exam.id);
  }

  function hasProgram(section: string) {
    return (grade: string) =>
      exams.programGrades.some((p) => p.section === section && p.grade === grade);
  }

  /** Where the registration stands; how the exam went is not shown here. */
  function stateOf(reg: MemberRegistration): CandidateState {
    if (reg.finished) return 'examined';
    if (reg.status === 'withdrawn') return 'withdrawn';
    return reg.started ? 'grading' : reg.status;
  }

  function isOpen(exam: Exam): boolean {
    return (exam.registration_deadline ?? exam.date) >= today && exam.date >= today;
  }

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

{#if exams.upcoming.length > 0}
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
            <!-- Outlined, not filled, so the neutral "registered" chip stays visible -->
            <div class="rounded-md border border-surface-200-800 bg-surface-50-950 p-3 space-y-2">
              <div class="flex items-center gap-2">
                {#if def}<BeltStrip color={def.beltColor} color2={def.beltColor2} />{/if}
                <span class="font-semibold">{reg.grade}</span>
                <span class="ml-auto"><ExamStateChip state={stateOf(reg)} /></span>
              </div>
              {#if reg.finished}
                <p class="text-sm">{$_('page.club.exams.examined')}</p>
              {:else if reg.status === 'withdrawn'}
                <p class="text-sm">{$_('page.club.exams.askTrainer')}</p>
              {:else if reg.status === 'invited' && (reg.group_name || reg.call_time)}
                <p class="text-sm">
                  {$_('page.club.exams.callUp', {
                    values: {
                      group: reg.group_name ?? '–',
                      time: reg.call_time ?? '–'
                    }
                  })}
                </p>
              {:else if !reg.started}
                <p class="text-sm">{$_('page.club.exams.waitForCallUp')}</p>
              {/if}
            </div>
            <div class="flex flex-wrap gap-2">
              {#if open && reg.status === 'registered' && !reg.started}
                <button
                  class="btn preset-tonal-surface text-sm"
                  onclick={() => openForm(exam, reg)}
                >
                  <Fa icon={faEdit} />
                  <span>{$_('button.edit')}</span>
                </button>
              {/if}
              {#if reg.status !== 'withdrawn' && !reg.started}
                <button
                  class="btn preset-tonal-error text-sm"
                  onclick={() => (confirmWithdraw = { reg, exam })}
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
      {/each}
    </div>
  </section>
{/if}

{#if confirmWithdraw}
  {@const { reg, exam } = confirmWithdraw}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (confirmWithdraw = null)}
    onkeydown={(e) => {
      if (e.key === 'Escape') confirmWithdraw = null;
    }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div use:modalDialog class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('dialog.confirm.title')}</h3>
      <p class="mb-4">
        {$_('page.club.exams.withdrawConfirm', {
          values: { name: member.firstname, title: exam.title }
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
