<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
  import { menu, type ModalSettings, Avatar } from '@skeletonlabs/skeleton';
  import { modalStore } from '@skeletonlabs/skeleton';
  import Labels from './Labels.svelte';
  import ParticipantFrequency from './ParticipantFrequency.svelte';
  import { _ } from 'svelte-i18n';

  import type { MMember } from './types';
  import type { TrainerRole } from '$lib/models';

  export let member: MMember;
  export let highlight = false;

  const dispatch = createEventDispatcher();

  function change() {
    dispatch('change', { member, checked: !member.isPresent, trainerRole: 'attendee' });
  }

  function triggerConfirm(): void {
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
    dispatch('change', { member, checked: true, trainerRole: role });
  }
</script>

<li
  class="rounded-lg transition-colors {highlight ? 'bg-primary-100 dark:bg-primary-900/30' : ''} {member.isPresent ? '' : 'opacity-50'}"
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
    <div class="justify-self-end relative flex-shrink-0">
      <button class="btn btn-sm" use:menu={{ menu: 'ParticipantCard' + member.id }}>
        <Fa icon={faEllipsisVertical} />
      </button>
      <nav class="card p-2 w-48 shadow-xl z-50" data-menu={'ParticipantCard' + member.id}>
        <ul>
          <li>
            <a href={'/dashboard/members/' + member.id} class="btn option w-full">
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
    </div>
  {:else}
    {$_('page.trainings.memberNotFound')}
  {/if}
</li>
