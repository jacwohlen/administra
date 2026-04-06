<script lang="ts">
  import type { PageData } from './$types';
  import type { MMember } from './types';
  import type { Member } from '$lib/models';
  import type { TrainerRole } from '$lib/models';
  import ParticipantCard from './ParticipantCard.svelte';
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
  import { goto } from '$app/navigation';
  import AddParticipantInputBox from './AddParticipantInputBox.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import { flip } from 'svelte/animate';
  import { quintInOut } from 'svelte/easing';
  import LessonPlan from './LessonPlan.svelte';

  let { data }: { data: PageData } = $props();
  let searchterm = $state('');
  let animateList = $state(true);
  let showLessonPlan = $state(false);

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

    filteredData = filteredData.sort((a, b) => {
      if (a.isPresent && !b.isPresent) {
        return -1;
      } else if (!a.isPresent && b.isPresent) {
        return 1;
      } else {
        return 0;
      }
    });
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

  async function _changePresence(member: MMember, checked: boolean, trainerRole: TrainerRole) {
    const index = data.participants.findIndex((m) => m.id === member.id);
    data.participants[index].isPresent = checked;
    data.participants[index].trainerRole = trainerRole;
    clearSearch();

    const { error } = await supabaseClient
      .from('logs')
      .delete()
      .eq('date', data.date)
      .eq('trainingId', data.trainingId)
      .eq('memberId', member.id);
    if (error) {
      console.log(error);
    }

    if (checked) {
      const { error } = await supabaseClient.from('logs').insert({
        date: data.date,
        trainingId: data.trainingId,
        memberId: member.id,
        trainerRole
      });
      if (error) {
        console.log(error);
      }
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

  async function nextWeek() {
    let d = dayjs(data.date, 'YYYY-MM-DD');
    d = d.add(7, 'days');
    await goto(d.format('YYYY-MM-DD'));
    filterData();
  }

  async function previousWeek() {
    let d = dayjs(data.date, 'YYYY-MM-DD');
    d = d.subtract(7, 'days');
    await goto(d.format('YYYY-MM-DD'));
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
  <button class="btn preset-tonal-surface" onclick={previousWeek}>
    <Fa icon={faArrowLeft} />
    <span class="hidden sm:inline">{$_('button.week')}</span>
  </button>
  <h3>{formattedDate}</h3>
  <button class="btn preset-tonal-surface" onclick={nextWeek}>
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
        <ParticipantCard member={p} onchange={changePresence} onremove={removeParticipant} />
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
