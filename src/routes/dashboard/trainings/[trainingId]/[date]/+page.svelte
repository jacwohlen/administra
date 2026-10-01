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
    faArrowRight,
    faExclamationTriangle,
    faClipboardList,
    faUsers,
    faUserCheck,
    faChalkboardTeacher
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { goto, preloadData } from '$app/navigation';
  import AddParticipantInputBox from './AddParticipantInputBox.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { _ } from 'svelte-i18n';
  import { flip } from 'svelte/animate';
  import { quintInOut } from 'svelte/easing';
  import LessonPlan from './LessonPlan.svelte';

  let { data }: { data: PageData } = $props();
  let searchterm = $state('');
  let animateList = $state(true);
  let showLessonPlan = $state(false);
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
    } else if (e.key === 'Enter') {
      _changePresence(filteredData[hiIndex], !filteredData[hiIndex].isPresent, 'attendee');
      clearSearch();
    } else {
      return;
    }
  };

  let formattedDate = $derived(dayjs(data.date, 'YYYY-MM-DD').format('DD. MMMM YYYY'));
</script>

<!-- Header card -->
<div class="card p-4 mb-4">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div>
      <h1>{data.title}</h1>
      <div class="flex items-center gap-2 mt-1">
        <span class="badge preset-tonal-secondary">{data.section}</span>
        <span class="text-sm opacity-70">
          {$_('weekday.' + data.weekday)} | {data.dateFrom}
        </span>
      </div>
    </div>
  </div>
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
    <Fa icon={faArrowLeft} />
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
    <Fa icon={faArrowRight} />
  </button>
</div>

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
        <img class="inline-block w-3.5" src="/judo-icon.svg" alt="trainer" />
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
        />
      </div>
    {/each}
    <li>
      <div
        class="flex items-center gap-4 p-4 rounded-lg preset-tonal-tertiary w-full justify-items-center"
      >
        <AddParticipantInputBox onadd={addParticipant} />
      </div>
    </li>
  </ul>
{:else}
  <LessonPlan trainingId={data.trainingId} date={data.date} />
{/if}

<BadgeCelebration badges={celebrationBadges} memberName={celebrationMemberName} />
