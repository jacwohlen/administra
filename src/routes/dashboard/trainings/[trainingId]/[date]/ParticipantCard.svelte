<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
  import { type ModalSettings, Avatar } from '@skeletonlabs/skeleton';
  import { modalStore } from '@skeletonlabs/skeleton';
  import Labels from './Labels.svelte';
  import ParticipantFrequency from './ParticipantFrequency.svelte';
  import { _ } from 'svelte-i18n';

  import type { MMember } from './types';
  import type { TrainerRole } from '$lib/models';

  export let member: MMember;
  export let highlight = false;

  const dispatch = createEventDispatcher();

  let menuOpen = false;
  let menuStyle = '';
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
    menuStyle = `position:fixed;top:${top}px;left:${left}px;z-index:9999;${transformY ? `transform:${transformY};` : ''}`;
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
    dispatch('change', { member, checked: !member.isPresent, trainerRole: 'attendee' });
  }

  function triggerConfirm(): void {
    closeMenu();
    const confirm: ModalSettings = {
      type: 'confirm',
      title: $_('dialog.confirm.title'),
      body: $_('dialog.confirm.body'),
      response: (r: boolean) => r === true && dispatch('remove', { member }),
      buttonTextCancel: $_('button.cancel'),
      buttonTextConfirm: $_('button.confirm')
    };
    modalStore.trigger(confirm);
  }

  function setTrainerRole(role: TrainerRole): void {
    closeMenu();
    dispatch('change', { member, checked: true, trainerRole: role });
  }
</script>

<svelte:window on:click={handleWindowClick} />

<li
  class="rounded-lg transition-colors {highlight
    ? 'bg-primary-100 dark:bg-primary-900/30'
    : ''} {member.isPresent ? '' : 'opacity-50'}"
>
  {#if member}
    <input
      class="checkbox"
      type="checkbox"
      value={member.id}
      checked={member.isPresent}
      on:change={change}
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
        <ParticipantFrequency streak={member.streak} />
      </dd>
    </span>
    <div class="justify-self-end flex-shrink-0">
      <button class="btn btn-sm" bind:this={btnEl} on:click|stopPropagation={toggleMenu}>
        <Fa icon={faEllipsisVertical} />
      </button>
      {#if menuOpen}
        <nav class="card p-2 w-48 shadow-xl" style={menuStyle}>
          <ul>
            <li>
              <a href={'/dashboard/members/' + member.id} class="btn option w-full" on:click={closeMenu}>
                {$_('components.ParticipantCard.View')}
              </a>
            </li>
            <li class="border-t border-surface-300 pt-2 mt-2">
              <button class="option w-full" on:click={() => setTrainerRole('attendee')}>
                {$_('components.ParticipantCard.SetAsAttendee')}
              </button>
            </li>
            <li>
              <button class="option w-full" on:click={() => setTrainerRole('main_trainer')}>
                <img class="inline-block w-4" src="/judo-icon.svg" alt="judo-icon" />
                <span class="pl-1">{$_('components.ParticipantCard.SetAsMainTrainer')}</span>
              </button>
            </li>
            <li>
              <button class="option w-full" on:click={() => setTrainerRole('assistant')}>
                <span class="inline-block w-4 text-center font-bold text-gray-600">A</span>
                <span class="pl-1">{$_('components.ParticipantCard.SetAsAssistant')}</span>
              </button>
            </li>
            <li class="border-t border-surface-300 pt-2 mt-2">
              <button class="option w-full text-error-500" on:click={triggerConfirm}>
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
