<script lang="ts">
  import Fa from 'svelte-fa';
  import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
  import { Avatar } from '@skeletonlabs/skeleton-svelte';

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
  let showRemoveConfirm = $state(false);

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
    showRemoveConfirm = true;
  }

  function handleRemoveResponse(confirmed: boolean) {
    showRemoveConfirm = false;
    if (confirmed) {
      onremove?.({ member });
    }
  }

  function setTrainerRole(role: TrainerRole): void {
    closeMenu();
    onchange?.({ member, checked: true, trainerRole: role });
  }
</script>

<svelte:window onclick={handleWindowClick} />

<li class="flex items-center gap-3 py-2 border-b border-surface-300-700">
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
          class="badge-icon absolute -bottom-0 -right-0 z-10 bg-warning-600-400 rounded-full w-5 h-5 flex items-center justify-center"
        >
          <img class="w-3.5" src="/judo-icon.svg" alt="main-trainer" />
        </span>
      {:else if member.trainerRole === 'assistant'}
        <span
          class="badge-icon absolute -bottom-0 -right-0 z-10 preset-filled-surface text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full"
        >
          A
        </span>
      {/if}
      {#if member.img}
        <Avatar class="size-10 rounded-full overflow-hidden">
          <Avatar.Image src={member.img} alt="{member.lastname} {member.firstname}" />
          <Avatar.Fallback>{member.lastname.charAt(0)}{member.firstname.charAt(0)}</Avatar.Fallback>
        </Avatar>
      {:else}
        <Avatar class="size-10 rounded-full overflow-hidden">
          <Avatar.Fallback>{member.lastname.charAt(0)}{member.firstname.charAt(0)}</Avatar.Fallback>
        </Avatar>
      {/if}
    </div>
    <span class="flex-auto min-w-0">
      <dt class="font-semibold truncate">{member.lastname} {member.firstname}</dt>
      <dd class="flex items-center gap-2 flex-wrap">
        <Labels labels={member.labels ? member.labels : []} />
        <ParticipantFrequency streak={member.streak} isPresent={member.isPresent} />
      </dd>
    </span>
    <div class="justify-self-end flex-shrink-0">
      <button
        class="btn btn-sm"
        bind:this={btnEl}
        onclick={(e) => {
          e.stopPropagation();
          toggleMenu();
        }}
      >
        <Fa icon={faEllipsisVertical} />
      </button>
      {#if menuOpen}
        <nav
          class="card p-2 w-56 shadow-xl bg-surface-50-950 border border-surface-300-700"
          style={menuStyle}
        >
          <ul class="list-none m-0 p-0">
            <li>
              <a
                href={'/dashboard/members/' + member.id}
                class="btn btn-sm w-full text-left justify-start"
                onclick={closeMenu}
              >
                {$_('components.ParticipantCard.View')}
              </a>
            </li>
            <li class="border-t border-surface-300-700 pt-1 mt-1">
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
                <span class="w-4 flex-shrink-0 text-center font-bold text-surface-600-400">A</span>
                {$_('components.ParticipantCard.SetAsAssistant')}
              </button>
            </li>
            <li class="border-t border-surface-300-700 pt-1 mt-1">
              <button
                class="btn btn-sm w-full text-left justify-start text-error-600-400"
                onclick={triggerConfirm}
              >
                {$_('components.ParticipantCard.Remove')}
              </button>
            </li>
          </ul>
        </nav>
      {/if}
    </div>

    {#if showRemoveConfirm}
      <div class="card p-4 mt-2 border border-error-600-400 w-full">
        <h4 class="font-semibold mb-2">{$_('dialog.confirm.title')}</h4>
        <p class="mb-3">{$_('dialog.confirm.body')}</p>
        <div class="flex justify-end gap-2">
          <button
            class="btn btn-sm preset-tonal-surface"
            onclick={() => handleRemoveResponse(false)}
          >
            {$_('button.cancel')}
          </button>
          <button
            class="btn btn-sm preset-filled-error-500"
            onclick={() => handleRemoveResponse(true)}
          >
            {$_('button.confirm')}
          </button>
        </div>
      </div>
    {/if}
  {:else}
    {$_('page.trainings.memberNotFound')}
  {/if}
</li>
