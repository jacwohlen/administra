<script lang="ts">
  import Fa from 'svelte-fa';
  import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
  import { type ModalSettings, Avatar } from '@skeletonlabs/skeleton';
  import { modalStore } from '@skeletonlabs/skeleton';
  import Labels from './Labels.svelte';
  import ParticipantFrequency from './ParticipantFrequency.svelte';
  import { _ } from 'svelte-i18n';

  import type { MMember } from './types';
  import type { TrainerRole } from '$lib/models';

  let {
    member,
    onchange,
    onremove
  }: {
    member: MMember;
    onchange?: (data: { member: MMember; checked: boolean; trainerRole: TrainerRole }) => void;
    onremove?: (data: { member: MMember }) => void;
  } = $props();

  let menuOpen = $state(false);
  let menuStyle = $state('');
  let btnEl: HTMLButtonElement;

  function toggleMenu() {
    if (menuOpen) {
      menuOpen = false;
      return;
    }
    const rect = btnEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceRight = window.innerWidth - rect.right;
    const top = spaceBelow < 220 ? rect.top : rect.bottom + 4;
    const transformY = spaceBelow < 220 ? 'translateY(-100%)' : '';
    const left = spaceRight < 200 ? rect.right - 192 : rect.left;
    menuStyle = `position:fixed;top:${top}px;left:${left}px;z-index:9999;${
      transformY ? `transform:${transformY};` : ''
    }`;
    menuOpen = true;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function handleWindowClick(e: MouseEvent) {
    if (menuOpen && btnEl && !btnEl.contains(e.target as Node)) {
      menuOpen = false;
    }
  }

  function change() {
    onchange?.({ member, checked: !member.isPresent, trainerRole: 'attendee' });
  }

  function triggerConfirm(): void {
    closeMenu();
    const confirm: ModalSettings = {
      type: 'confirm',
      title: $_('dialog.confirm.title'),
      body: $_('dialog.confirm.body'),
      response: (r: boolean) => r === true && onremove?.({ member }),
      buttonTextCancel: $_('button.cancel'),
      buttonTextConfirm: $_('button.confirm')
    };
    modalStore.trigger(confirm);
  }

  function setTrainerRole(role: TrainerRole): void {
    closeMenu();
    onchange?.({ member, checked: true, trainerRole: role });
  }
</script>

<svelte:window onclick={handleWindowClick} />

<li>
  {#if member}
    <input
      class="checkbox"
      type="checkbox"
      value={member.id}
      checked={member.isPresent}
      onchange={change}
    />
    <div class="relative inline-block flex-shrink-0">
      {#if member.trainerRole === 'main_trainer'}
        <span
          class="badge-icon absolute -bottom-0 -right-0 z-10 bg-warning-500 rounded-full w-5 h-5 flex items-center justify-center"
        >
          <img class="w-3.5" src="/judo-icon.svg" alt="main-trainer" />
        </span>
      {:else if member.trainerRole === 'assistant'}
        <span
          class="badge-icon absolute -bottom-0 -right-0 z-10 bg-surface-400 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full"
        >
          A
        </span>
      {/if}
      {#if member.img}
        <Avatar src={member.img} width="w-10" />
      {:else}
        <Avatar initials={member.lastname.charAt(0) + member.firstname.charAt(0)} width="w-10" />
      {/if}
    </div>
    <span class="flex-auto min-w-0">
      <dt class="font-semibold truncate">{member.lastname} {member.firstname}</dt>
      <dd>
        <Labels labels={member.labels ? member.labels : []} />
      </dd>
      <dd>
        <ParticipantFrequency streak={member.streak} isPresent={member.isPresent} />
      </dd>
    </span>
    <div class="justify-self-end flex-shrink-0">
      <button class="btn btn-sm" bind:this={btnEl} onclick={(e) => { e.stopPropagation(); toggleMenu(); }}>
        <Fa icon={faEllipsisVertical} />
      </button>
      {#if menuOpen}
        <nav class="card p-2 w-56 shadow-xl" style={menuStyle}>
          <ul>
            <li>
              <a
                href={'/dashboard/members/' + member.id}
                class="btn btn-sm w-full text-left justify-start"
                onclick={closeMenu}
              >
                {$_('components.ParticipantCard.View')}
              </a>
            </li>
            <li class="border-t border-surface-300 pt-1 mt-1">
              <button
                class="btn btn-sm w-full text-left justify-start"
                onclick={() => setTrainerRole('attendee')}
              >
                {$_('components.ParticipantCard.SetAsAttendee')}
              </button>
            </li>
            <li>
              <button
                class="btn btn-sm w-full text-left justify-start gap-2"
                onclick={() => setTrainerRole('main_trainer')}
              >
                <img class="w-4 flex-shrink-0" src="/judo-icon.svg" alt="judo-icon" />
                {$_('components.ParticipantCard.SetAsMainTrainer')}
              </button>
            </li>
            <li>
              <button
                class="btn btn-sm w-full text-left justify-start gap-2"
                onclick={() => setTrainerRole('assistant')}
              >
                <span class="w-4 flex-shrink-0 text-center font-bold text-gray-600">A</span>
                {$_('components.ParticipantCard.SetAsAssistant')}
              </button>
            </li>
            <li class="border-t border-surface-300 pt-1 mt-1">
              <button
                class="btn btn-sm w-full text-left justify-start text-error-500"
                onclick={triggerConfirm}
              >
                {$_('components.ParticipantCard.Remove')}
              </button>
            </li>
          </ul>
        </nav>
      {/if}
    </div>
  {:else}
    {$_('page.trainings.memberNotFound')}
  {/if}
</li>
