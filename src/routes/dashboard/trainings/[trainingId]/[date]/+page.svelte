<script lang="ts">
  import type { PageData } from './$types';
  import type { MMember } from './types';
  import type { Badge, Member } from '$lib/models';
  import type { TrainerRole } from '$lib/models';
  import ParticipantCard from './ParticipantCard.svelte';
  import BadgeCelebration from '$lib/components/BadgeCelebration.svelte';
  import { compareChecklistMembers } from '$lib/trainingUtils';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faChevronLeft,
    faChevronRight,
    faExclamationTriangle,
    faClipboardList,
    faUsers,
    faUserCheck,
    faChalkboardTeacher,
    faCalendarWeek
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { onMount } from 'svelte';
  import { goto, invalidateAll, preloadData } from '$app/navigation';
  import AddParticipantInputBox from './AddParticipantInputBox.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { _ } from 'svelte-i18n';
  import { flip } from 'svelte/animate';
  import { quintInOut } from 'svelte/easing';
  import LessonPlan from './LessonPlan.svelte';
  import { isCancelled } from '$lib/trainingPlanUtils';
  import AssistantButton from '$lib/components/assistant/AssistantButton.svelte';
  import AssistantDialog from '$lib/components/assistant/AssistantDialog.svelte';
  import AttendanceReview from '$lib/components/assistant/AttendanceReview.svelte';
  import { isAssistantRequested, takeAssistantRequest } from '$lib/assistant/autoOpen';

  let { data }: { data: PageData } = $props();
  let searchterm = $state('');
  let animateList = $state(true);
  // Daten-Assistent: a lesson plan to read opens on its tab, once. The page
  // answers the request (LessonPlan mounts again on every tab switch).
  const lessonPlanRequested = isAssistantRequested('lesson_plan');
  let showLessonPlan = $state(lessonPlanRequested);
  let lessonPlanAutoOpen = $state(lessonPlanRequested);
  let showAssistant = $state(false);
  let celebrationBadges: Badge[] = $state([]);
  let celebrationMemberName = $state('');

  let filteredData: MMember[] = $state([]);
  let presentParticipants = $derived(filteredData.filter((p) => p.isPresent));
  let mainTrainers = $derived(presentParticipants.filter((p) => p.trainerRole === 'main_trainer'));
  let assistantTrainers = $derived(
    presentParticipants.filter((p) => p.trainerRole === 'assistant')
  );
  let hasMainTrainer = $derived(mainTrainers.length > 0);

  let hiIndex = -1;

  const filterData = async () => {
    filteredData = data.participants.filter((p) => {
      const s = searchterm.toLowerCase();
      return p.lastname.toLowerCase().startsWith(s) || p.firstname.toLowerCase().startsWith(s);
    });

    hiIndex = filteredData.length > 0 && searchterm ? 0 : -1;

    filteredData = filteredData.sort(compareChecklistMembers);
  };

  function clearSearch() {
    searchterm = '';
    hiIndex = -1;
    filterData();
  }

  filterData();

  async function changePresence(detail: {
    member: MMember;
    checked: boolean;
    trainerRole: TrainerRole;
  }) {
    await _changePresence(detail.member, detail.checked, detail.trainerRole);
  }

  // Latest request per member, so a slow answer to an earlier click cannot
  // undo a later one, and the last state the database confirmed, to fall back
  // to when saving fails.
  const pendingChange = new Map<string, number>();
  const confirmed = new Map<string, { isPresent: boolean; trainerRole: TrainerRole }>();
  let changeCounter = 0;

  async function _changePresence(member: Member, checked: boolean, trainerRole: TrainerRole) {
    const participant = data.participants.find((m) => m.id === member.id);
    if (!participant) return;
    if (!confirmed.has(member.id)) {
      confirmed.set(member.id, {
        isPresent: participant.isPresent,
        trainerRole: participant.trainerRole
      });
    }

    // Show the change right away; the request runs in the background.
    participant.isPresent = checked;
    participant.trainerRole = trainerRole;
    clearSearch();

    const request = ++changeCounter;
    pendingChange.set(member.id, request);

    // One transaction: writes the log row and returns the badges the check-in
    // earned (awarded by triggers on logs).
    const { data: rows, error } = await supabaseClient.rpc('set_attendance', {
      p_date: data.date,
      p_training_id: parseInt(data.trainingId),
      p_member_id: parseInt(member.id),
      p_present: checked,
      p_trainer_role: trainerRole
    });

    if (pendingChange.get(member.id) !== request) return;
    pendingChange.delete(member.id);

    if (error) {
      console.error('Error saving attendance:', error);
      const last = confirmed.get(member.id)!;
      participant.isPresent = last.isPresent;
      participant.trainerRole = last.trainerRole;
      filterData();
      toaster.error({
        title: $_('page.trainings.attendanceSaveError', {
          values: { name: `${member.firstname} ${member.lastname}` }
        })
      });
      return;
    }
    confirmed.set(member.id, { isPresent: checked, trainerRole });

    const fresh = Array.isArray(rows) ? (rows as Badge[]) : [];
    if (fresh.length > 0) {
      celebrationMemberName = `${member.firstname} ${member.lastname}`;
      celebrationBadges = fresh;
    }
  }

  async function addParticipant(detail: { member: Member | MMember }) {
    const foundIndex = filteredData.findIndex((item) => item.id === detail.member.id);
    if (foundIndex > -1) {
      return;
    }
    const d = await supabaseClient
      .from('participants')
      .upsert({ trainingId: data.trainingId, memberId: detail.member.id })
      .select('members(*)')
      .single();

    if (d.data?.members) {
      const newMember = { ...(d.data.members as unknown as MMember), streak: [] };
      data.participants.push(newMember);
    }
    _changePresence(detail.member, true, 'attendee');
    filterData();
  }

  async function removeParticipant(detail: { member: MMember }) {
    await supabaseClient
      .from('participants')
      .delete()
      .eq('trainingId', data.trainingId)
      .eq('memberId', detail.member.id);
    const index = data.participants.findIndex((p) => p.id === detail.member.id);
    if (index > -1) {
      data.participants.splice(index, 1);
      filterData();
    }
  }

  function weekPath(offset: number): string {
    return dayjs(data.date, 'YYYY-MM-DD')
      .add(offset * 7, 'days')
      .format('YYYY-MM-DD');
  }

  // Start loading the neighbouring week while the pointer is on its button,
  // like links do (data-sveltekit-preload-data), so switching feels instant.
  function preloadWeek(offset: number) {
    preloadData(weekPath(offset));
  }

  async function nextWeek() {
    await goto(weekPath(1));
    filterData();
  }

  async function previousWeek() {
    await goto(weekPath(-1));
    filterData();
  }

  const navigateList = (e: { key: string }) => {
    if (e.key === 'ArrowDown' && hiIndex <= filteredData.length - 1) {
      hiIndex = hiIndex === filteredData.length - 1 ? 0 : hiIndex + 1;
    } else if (e.key === 'ArrowUp' && hiIndex !== -1) {
      hiIndex = hiIndex === 0 ? filteredData.length - 1 : hiIndex - 1;
    } else if (e.key === 'Enter' && data.canWrite) {
      _changePresence(filteredData[hiIndex], !filteredData[hiIndex].isPresent, 'attendee');
      clearSearch();
    } else {
      return;
    }
  };

  let planCancelled = $derived(data.plan ? isCancelled(data.plan.session, data.plan.break) : false);
  let planTrainer = $derived(data.plan?.session?.trainer);

  let formattedDate = $derived(dayjs(data.date, 'YYYY-MM-DD').format('DD. MMMM YYYY'));

  // Daten-Assistent: the training of this page, only when its id is the page's own
  let assistantTraining = $derived(
    Number.isInteger(Number(data.id)) && Number(data.id) === Number(data.trainingId)
      ? {
          id: Number(data.id),
          title: data.title,
          weekday: data.weekday ?? null,
          dateFrom: data.dateFrom ?? null
        }
      : null
  );

  onMount(() => {
    if (lessonPlanRequested) takeAssistantRequest('lesson_plan');
    if (data.canWrite && takeAssistantRequest('attendance')) showAssistant = true;
  });

  // A save that failed in part keeps the review open for the rest; what it
  // wrote shows once the dialog closes
  let assistantSavedSome = false;

  async function reloadAfterAssistant() {
    try {
      await invalidateAll();
    } finally {
      filterData();
    }
  }

  // After a bulk import: reload the list, and close the review even if that fails
  async function assistantApplied() {
    assistantSavedSome = false;
    try {
      await reloadAfterAssistant();
    } finally {
      showAssistant = false;
    }
  }

  function closeAssistant() {
    showAssistant = false;
    if (!assistantSavedSome) return;
    assistantSavedSome = false;
    reloadAfterAssistant().catch((err) =>
      console.error('Error reloading after the attendance list:', err)
    );
  }
</script>

<!-- Header: back to the training + title -->
<div class="page-header-back">
  <a
    href="/dashboard/trainings/{data.trainingId}"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.trainings.backToTraining')}
    aria-label={$_('page.trainings.backToTraining')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{data.title}</h1>
</div>
<div class="flex flex-wrap items-center gap-2 mb-4 text-sm">
  <span class="chip preset-tonal-secondary">{data.section}</span>
  <span class="text-surface-600-400">{$_('weekday.' + data.weekday)} | {data.dateFrom}</span>
  {#if data.canWrite && assistantTraining}
    <span class="ml-auto">
      <AssistantButton
        iconOnly
        label={$_('assistant.kinds.attendance.title')}
        onclick={() => (showAssistant = true)}
      />
    </span>
  {/if}
</div>

<!-- Date navigation -->
<div class="page-header">
  <button
    class="btn preset-tonal-surface"
    onclick={previousWeek}
    onpointerenter={() => preloadWeek(-1)}
    ontouchstart={() => preloadWeek(-1)}
    onfocus={() => preloadWeek(-1)}
  >
    <Fa icon={faChevronLeft} />
    <span class="hidden sm:inline">{$_('button.week')}</span>
  </button>
  <h3>{formattedDate}</h3>
  <button
    class="btn preset-tonal-surface"
    onclick={nextWeek}
    onpointerenter={() => preloadWeek(1)}
    ontouchstart={() => preloadWeek(1)}
    onfocus={() => preloadWeek(1)}
  >
    <span class="hidden sm:inline">{$_('button.week')}</span>
    <Fa icon={faChevronRight} />
  </button>
</div>

<!-- Trainingsplanung: the TK's plan for this date -->
{#if data.plan && (planCancelled || data.plan.session?.topic || data.plan.session?.trainer_id != null || data.plan.session?.notes)}
  <a
    href="/dashboard/training-plan?year={data.date.slice(0, 4)}"
    class="card border flex items-center gap-3 px-3 py-2.5 mb-4 transition-colors {planCancelled
      ? 'preset-tonal-warning border-warning-500/30'
      : 'border-surface-200-800 hover:bg-surface-100-900'}"
  >
    <div
      class="entity-badge {planCancelled
        ? 'bg-warning-500/20! text-warning-800-200'
        : 'text-primary-600-400'}"
    >
      <Fa icon={faCalendarWeek} size="lg" />
    </div>
    <div class="flex-1 min-w-0 text-sm">
      {#if planCancelled}
        <p class="font-semibold">
          {data.plan.session?.cancelled
            ? $_('page.trainingPlan.checkin.cancelled')
            : $_('page.trainingPlan.checkin.cancelledBreak', {
                values: { title: data.plan.break?.title ?? '' }
              })}
        </p>
      {:else}
        {#if data.plan.session?.topic}
          <p>
            <span class="font-semibold">{$_('page.trainingPlan.topic')}:</span>
            {data.plan.session.topic}
          </p>
        {/if}
        <p>
          <span class="font-semibold">{$_('page.trainingPlan.trainer')}:</span>
          {planTrainer
            ? `${planTrainer.firstname} ${planTrainer.lastname}`
            : $_('page.trainingPlan.trainerOpen')}
        </p>
      {/if}
      {#if data.plan.session?.notes}
        <p class="text-surface-600-400">{data.plan.session.notes}</p>
      {/if}
    </div>
    <Fa
      icon={faChevronRight}
      class="flex-none {planCancelled ? 'opacity-60' : 'text-surface-400-600'}"
    />
  </a>
{/if}

<!-- View toggle tabs -->
<div class="flex rounded-lg overflow-hidden border border-surface-300-700 mb-4">
  <button
    class="btn flex-1 rounded-none {!showLessonPlan
      ? 'preset-filled-primary-500'
      : 'preset-tonal-surface'}"
    onclick={() => (showLessonPlan = false)}
  >
    <Fa icon={faUsers} />
    <span>{$_('page.trainings.attendance')}</span>
  </button>
  <button
    class="btn flex-1 rounded-none {showLessonPlan
      ? 'preset-filled-primary-500'
      : 'preset-tonal-surface'}"
    onclick={() => (showLessonPlan = true)}
  >
    <Fa icon={faClipboardList} />
    <span>{$_('page.trainings.lessonPlan')}</span>
  </button>
</div>

{#if !showLessonPlan}
  <!-- Stats bar -->
  <div class="flex gap-2 mb-3 flex-wrap">
    <span class="chip bg-surface-100-900 text-surface-900-50">
      <Fa icon={faUserCheck} size="sm" />
      <span>{presentParticipants.length} / {filteredData.length}</span>
    </span>
    {#if mainTrainers.length > 0}
      <span class="chip bg-surface-100-900 text-surface-900-50">
        <img class="inline-block w-3.5" src="/judo-icon.svg" alt={$_('page.stats.mainTrainer')} />
        <span>{mainTrainers.length}</span>
      </span>
    {/if}
    {#if assistantTrainers.length > 0}
      <span class="chip bg-surface-100-900 text-surface-900-50">
        <Fa icon={faChalkboardTeacher} size="sm" />
        <span>{assistantTrainers.length}</span>
      </span>
    {/if}
  </div>

  <!-- Trainer warning -->
  {#if presentParticipants.length > 0 && !hasMainTrainer}
    <div class="flex items-center gap-4 p-4 rounded-lg preset-tonal-warning mb-3">
      <div><Fa icon={faExclamationTriangle} class="text-warning-600-400" /></div>
      <div class="flex-1">
        <p>
          <span class="font-bold">{$_('page.trainings.noMainTrainerWarning.title')}</span>
          {$_('page.trainings.noMainTrainerWarning.message')}
        </p>
      </div>
    </div>
  {/if}

  <!-- Search -->
  <div class="sticky top-0 z-30 bg-surface-50-950 pb-3 -mx-3 px-3 sm:-mx-4 sm:px-4 pt-1">
    <input
      class="input"
      onkeydown={navigateList}
      type="text"
      placeholder={$_('page.trainings.searchMembersPlaceholder')}
      bind:value={searchterm}
      oninput={filterData}
      onfocus={() => (animateList = false)}
      onblur={() => (animateList = true)}
    />
  </div>

  <!-- Participant list -->
  <ul class="flex flex-col gap-2">
    {#each filteredData as p (p.id)}
      <div
        class="item"
        animate:flip={{ delay: 0, duration: animateList ? 400 : 0, easing: quintInOut }}
      >
        <ParticipantCard
          member={p}
          badgeEmoji={data.badgeMap[p.id]}
          grade={data.gradeMap[p.id]?.find((g) => g.section === data.section)}
          medals={data.medalMap[p.id]}
          trialAttendedCount={data.trialCountMap[p.id]}
          onchange={changePresence}
          onremove={removeParticipant}
          readonly={!data.canWrite}
        />
      </div>
    {/each}
    {#if data.canWrite}
      <li>
        <div
          class="flex items-center gap-4 p-4 rounded-lg preset-tonal-tertiary w-full justify-items-center"
        >
          <AddParticipantInputBox onadd={addParticipant} />
        </div>
      </li>
    {/if}
  </ul>
{:else}
  <LessonPlan
    trainingId={data.trainingId}
    date={data.date}
    readonly={!data.canWrite}
    autoOpen={lessonPlanAutoOpen}
    onautoopened={() => (lessonPlanAutoOpen = false)}
  />
{/if}

<BadgeCelebration badges={celebrationBadges} memberName={celebrationMemberName} />

{#if showAssistant && data.canWrite && assistantTraining}
  {@const training = assistantTraining}
  <AssistantDialog
    kind="attendance"
    context={{ trainingId: training.id, date: data.date }}
    onclose={closeAssistant}
  >
    {#snippet review(proposal, back)}
      <AttendanceReview
        {proposal}
        {training}
        date={data.date}
        roster={data.participants.map((p) => Number(p.id))}
        onback={back}
        onclose={closeAssistant}
        onapplied={assistantApplied}
        onpartial={() => (assistantSavedSome = true)}
      />
    {/snippet}
  </AssistantDialog>
{/if}
