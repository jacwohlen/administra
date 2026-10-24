<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faMagnifyingGlass, faSpinner, faTrash } from '@fortawesome/free-solid-svg-icons';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import { registrableGrades, suggestedGrade } from '$lib/examUtils';
  import type {
    Exam,
    ExamCandidate,
    ExamCandidateStatus,
    GradeDefinition,
    MemberCurrentGrade
  } from '$lib/models';

  let {
    exam,
    ladder,
    candidate = null,
    existingMemberIds,
    programGrades,
    groups,
    trainers,
    canManageExams,
    onclose,
    onsaved
  }: {
    exam: Exam;
    /** Grade ladder of the exam's section, lowest first */
    ladder: GradeDefinition[];
    /** The candidate to edit; null adds a new one */
    candidate?: ExamCandidate | null;
    existingMemberIds: number[];
    /** Grades of the exam's section that have a program */
    programGrades: string[];
    /** Group names and trainers already in use, offered as suggestions */
    groups: string[];
    trainers: string[];
    /** The TK may also remove examined candidates; trainers only unstarted ones */
    canManageExams: boolean;
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  interface SearchHit {
    id: number;
    firstname: string;
    lastname: string;
  }

  const STATUSES: ExamCandidateStatus[] = ['registered', 'invited', 'withdrawn'];

  // Starts from the candidate being edited, then belongs to the user
  // svelte-ignore state_referenced_locally
  let form = $state({
    grade: candidate?.grade ?? '',
    status: candidate?.status ?? ('invited' as ExamCandidateStatus),
    group_name: candidate?.group_name ?? '',
    call_time: candidate?.call_time ?? '',
    belt_length_cm: candidate?.belt_length_cm ?? (null as number | null),
    trainer: candidate?.trainer ?? '',
    note: candidate?.note ?? '',
    staff_note: candidate?.staff_note ?? ''
  });
  // svelte-ignore state_referenced_locally
  let member = $state<SearchHit | null>(
    candidate?.member
      ? {
          id: candidate.member.id,
          firstname: candidate.member.firstname,
          lastname: candidate.member.lastname
        }
      : null
  );
  let currentGrade = $state<string | null>(null);
  let searchTerm = $state('');
  let hits = $state<SearchHit[]>([]);
  let saving = $state(false);
  let confirmRemove = $state(false);

  let gradeOptions = $derived(
    candidate ? ladder.filter((g) => !g.isDan) : registrableGrades(ladder, currentGrade)
  );
  let selectedGrade = $derived(ladder.find((g) => g.grade === form.grade));
  // Examined (sheet started or result in): the candidate stays as examined,
  // a result is changed on the sheet by reopening it (the database enforces it)
  let examined = $derived(!!candidate?.started_at || !!candidate?.result);
  let gradeLocked = $derived(examined);
  let statusLocked = $derived(!!candidate?.result);

  async function search() {
    const term = searchTerm.trim();
    if (term.length < 2) {
      hits = [];
      return;
    }
    const { data } = await supabaseClient
      .from('view_search_members')
      .select('id, firstname, lastname')
      .ilike('fullname', `%${term}%`)
      .limit(20);
    hits = ((data ?? []) as SearchHit[]).filter((m) => !existingMemberIds.includes(m.id));
  }

  /** Picking a member suggests the next grade after their current one. */
  async function pick(hit: SearchHit) {
    member = hit;
    hits = [];
    searchTerm = '';
    const { data } = await supabaseClient.rpc('get_member_current_grades', {
      p_member_id: hit.id
    });
    const current = ((data ?? []) as MemberCurrentGrade[]).find((g) => g.section === exam.section);
    currentGrade = current?.grade ?? null;
    form.grade =
      suggestedGrade(ladder, currentGrade, (g) => programGrades.includes(g))?.grade ?? '';
  }

  async function save() {
    if (!member || !form.grade) return;
    saving = true;
    const row = {
      grade: form.grade,
      status: form.status,
      group_name: form.group_name.trim() || null,
      call_time: form.call_time || null,
      belt_length_cm: form.belt_length_cm || null,
      trainer: form.trainer.trim() || null,
      note: form.note.trim() || null,
      staff_note: form.staff_note.trim() || null
    };
    if (candidate) {
      // Only what was changed here: the list may be older than the row, e.g. a
      // member withdrew or an examiner started the sheet meanwhile
      const before = candidate as unknown as Record<string, unknown>;
      const patch = Object.fromEntries(
        Object.entries(row).filter(([key, value]) => value !== (before[key] ?? null))
      );
      if (Object.keys(patch).length === 0) {
        saving = false;
        onclose();
        return;
      }
      const id = candidate.id;
      const save = (fields: Record<string, unknown>) => {
        let update = supabaseClient.from('exam_candidates').update(fields).eq('id', id);
        // The sheet keeps the grade it was started with (the database enforces it too)
        if ('grade' in fields) update = update.is('started_at', null).is('result', null);
        return update.select('id');
      };
      let { data: rows, error } = await save(patch);
      let gradeRefused = false;
      if (!error && !rows?.length && 'grade' in patch) {
        // Scoring started meanwhile: keep the other changes, only the grade stays
        gradeRefused = true;
        const rest = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'grade'));
        if (Object.keys(rest).length > 0) {
          ({ data: rows, error } = await save(rest));
        } else {
          rows = [{ id }];
        }
      }
      saving = false;
      if (error || !rows?.length) {
        // An error, or the registration is gone
        console.error('Error saving candidate:', error);
        toaster.error({ title: $_('page.exams.candidate.saveError') });
        if (!error) onsaved();
        return;
      }
      if (gradeRefused) toaster.error({ title: $_('page.exams.candidate.gradeLocked') });
      onsaved();
      return;
    }
    const { error } = await supabaseClient.from('exam_candidates').insert({
      ...row,
      exam_id: exam.id,
      member_id: member.id,
      section: exam.section
    });
    saving = false;
    if (error) {
      console.error('Error saving candidate:', error);
      toaster.error({ title: $_('page.exams.candidate.saveError') });
      return;
    }
    onsaved();
  }

  async function remove() {
    if (!candidate) return;
    saving = true;
    const { error } = await supabaseClient.from('exam_candidates').delete().eq('id', candidate.id);
    saving = false;
    if (error) {
      console.error('Error removing candidate:', error);
      toaster.error({ title: $_('page.exams.candidate.removeError') });
      return;
    }
    onsaved();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  onclick={onclose}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="card modal-dialog modal-dialog-lg max-h-[90vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    <h3>{candidate ? $_('page.exams.candidate.edit') : $_('page.exams.candidate.add')}</h3>

    <form
      class="space-y-3"
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {#if member}
        <div class="flex items-center justify-between gap-2">
          <p class="font-semibold">{member.firstname} {member.lastname}</p>
          {#if !candidate}
            <button
              type="button"
              class="btn btn-sm preset-tonal-surface"
              onclick={() => (member = null)}
            >
              {$_('page.exams.candidate.otherMember')}
            </button>
          {/if}
        </div>
      {:else}
        <div class="relative">
          <div class="input-group grid-cols-[auto_1fr]">
            <div class="ig-cell"><Fa icon={faMagnifyingGlass} /></div>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="input"
              type="text"
              autofocus
              placeholder={$_('page.exams.candidate.searchPlaceholder')}
              bind:value={searchTerm}
              oninput={search}
            />
          </div>
          {#if hits.length > 0}
            <ul class="card p-1 mt-1 shadow-xl bg-surface-50-950 max-h-60 overflow-y-auto">
              {#each hits as hit (hit.id)}
                <li>
                  <button
                    type="button"
                    class="w-full text-left p-2 rounded hover:bg-surface-100-900"
                    onclick={() => pick(hit)}
                  >
                    {hit.lastname}, {hit.firstname}
                  </button>
                </li>
              {/each}
            </ul>
          {:else if searchTerm.trim().length >= 2}
            <p class="text-sm text-surface-600-400 p-2">{$_('page.trainings.memberNotFound')}</p>
          {/if}
        </div>
      {/if}

      <label class="label">
        <span>{$_('page.exams.candidate.grade')}</span>
        <div class="flex items-center gap-2">
          {#if selectedGrade}
            <BeltStrip color={selectedGrade.beltColor} color2={selectedGrade.beltColor2} />
          {/if}
          <select class="select" bind:value={form.grade} disabled={!member || gradeLocked} required>
            {#each gradeOptions as g (g.grade)}
              <option value={g.grade}>{g.grade}</option>
            {/each}
          </select>
        </div>
        {#if gradeLocked}
          <span class="block text-xs text-surface-600-400"
            >{$_('page.exams.candidate.gradeLocked')}</span
          >
        {/if}
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class="label col-span-2 sm:col-span-1">
          <span>{$_('page.exams.candidate.group')}</span>
          <input
            class="input"
            type="text"
            list="exam-groups"
            bind:value={form.group_name}
            placeholder={$_('page.exams.candidate.groupPlaceholder')}
          />
          <datalist id="exam-groups">
            {#each groups as g (g)}<option value={g}></option>{/each}
          </datalist>
        </label>
        <label class="label col-span-2 sm:col-span-1">
          <span>{$_('page.exams.candidate.callTime')}</span>
          <input class="input" type="time" bind:value={form.call_time} />
        </label>
        <label class="label">
          <span>{$_('page.exams.candidate.beltLength')}</span>
          <input
            class="input"
            type="number"
            min="100"
            max="400"
            step="10"
            bind:value={form.belt_length_cm}
          />
        </label>
        <label class="label">
          <span>{$_('page.exams.candidate.status')}</span>
          <select class="select" bind:value={form.status} disabled={statusLocked}>
            {#each STATUSES as s (s)}
              <option value={s}>{$_('page.exams.state.' + s)}</option>
            {/each}
          </select>
        </label>
        {#if statusLocked}
          <p class="col-span-2 -mt-2 text-xs text-surface-600-400">
            {$_('page.exams.candidate.statusLocked')}
          </p>
        {/if}
      </div>

      <label class="label">
        <span>{$_('page.exams.candidate.trainer')}</span>
        <input class="input" type="text" list="exam-trainers" bind:value={form.trainer} />
        <datalist id="exam-trainers">
          {#each trainers as t (t)}<option value={t}></option>{/each}
        </datalist>
      </label>

      <label class="label">
        <span>{$_('page.exams.candidate.note')}</span>
        <textarea class="textarea" rows="2" maxlength="500" bind:value={form.note}></textarea>
        <span class="block text-xs text-surface-600-400">{$_('page.exams.candidate.noteHint')}</span
        >
      </label>

      <label class="label">
        <span>{$_('page.exams.candidate.staffNote')}</span>
        <textarea class="textarea" rows="2" maxlength="2000" bind:value={form.staff_note}
        ></textarea>
        <span class="block text-xs text-surface-600-400">
          {$_('page.exams.candidate.staffNoteHint')}
        </span>
      </label>

      <footer class="flex flex-wrap justify-between gap-2 pt-2">
        <div>
          {#if candidate && (!examined || canManageExams)}
            {#if confirmRemove}
              <button
                type="button"
                class="btn preset-filled-error-500"
                onclick={remove}
                disabled={saving}
              >
                {$_('page.exams.candidate.removeConfirm')}
              </button>
            {:else}
              <button
                type="button"
                class="btn preset-tonal-error"
                title={$_('button.remove')}
                onclick={() => (confirmRemove = true)}
              >
                <Fa icon={faTrash} />
              </button>
            {/if}
          {/if}
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn preset-tonal-surface" onclick={onclose}>
            {$_('button.cancel')}
          </button>
          <button
            type="submit"
            class="btn preset-filled-primary-500"
            disabled={saving || !member || !form.grade}
          >
            {#if saving}<Fa icon={faSpinner} spin />{/if}
            <span>{$_('button.save')}</span>
          </button>
        </div>
      </footer>
    </form>
  </div>
</div>
