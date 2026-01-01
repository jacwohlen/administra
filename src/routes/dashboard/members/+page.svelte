<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faGripLines, faPlus } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import { supabaseClient } from '$lib/supabase';
  import {
    toastStore,
    type ModalSettings,
    modalStore,
    type ModalComponent
  } from '@skeletonlabs/skeleton';
  import { invalidate } from '$app/navigation';
  import MemberForm from './MemberForm.svelte';

  export let data: PageData;
  let searchTerm = '';
  let isSubmitting = false;

  $: search = (firstname: string, lastname: string): boolean => {
    let q = searchTerm.toLowerCase().trim();
    let firstlast = firstname.toLowerCase() + ' ' + lastname.toLowerCase();
    let lastfirst = lastname.toLowerCase() + ' ' + firstname.toLowerCase();
    return firstlast.startsWith(q) || lastfirst.startsWith(q);
  };

  function showMemberForm() {
    const modalComponent: ModalComponent = {
      ref: MemberForm,
      props: { isSubmitting }
    };

    const modal: ModalSettings = {
      type: 'component',
      component: modalComponent,
      response: addMember
    };

    modalStore.trigger(modal);
  }

  async function addMember(
    result:
      | {
          id?: string;
          firstname: string;
          lastname: string;
          birthday?: string;
          mobile?: string;
          labels: string[];
        }
      | undefined
  ) {
    if (!result) return;

    isSubmitting = true;

    try {
      // Filter out empty id field for new members
      const { id, ...memberData } = result;
      const dataToInsert = {
        ...memberData,
        labels: result.labels || ['new'],
        // Only include id if it's not empty (for editing existing members)
        ...(id && id.trim() !== '' && { id: parseInt(id) })
      };

      const { error } = await supabaseClient.from('members').insert(dataToInsert).select().single();

      if (error) {
        throw error;
      }

      // Invalidate the members list to trigger a reload
      invalidate('members:list');

      // Show success toast
      toastStore.trigger({
        message: $_('page.members.createdSuccess'),
        background: 'variant-filled-success',
        timeout: 4000,
        classes: 'border-l-4 border-green-500'
      });
    } catch (error) {
      console.error('Error creating member:', error);
      toastStore.trigger({
        message: $_('page.members.createError'),
        background: 'variant-filled-error',
        timeout: 6000,
        classes: 'border-l-4 border-red-500'
      });
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="flex items-center justify-between mb-4">
  <h1>{$_('page.members.title')}</h1>
  <button class="btn btn-sm variant-filled-primary" on:click={showMemberForm}>
    <Fa icon={faPlus} />
    <span>{$_('page.members.addMember')}</span>
  </button>
</div>

<div class="m-2">
  <input
    class="input"
    bind:value={searchTerm}
    type="text"
    placeholder={$_('page.trainings.searchMembersPlaceholder')}
  />
</div>

<ul class="list">
  {#each data.members as m (m.id)}
    {#if search(m.firstname, m.lastname)}
      <li>
        <span class="flex-auto">
          <dt class="font-bold">
            {m.lastname}
            {m.firstname}
          </dt>
          <dd class="text-xs">
            {#if m.labels}
              {#each m.labels as l (l)}
                <span class="truncate text-wrap">
                  <span class="badge variant-filled-secondary font-normal h-4 m-0.5">{l}</span>
                </span>
              {/each}
            {/if}
          </dd>
        </span>
        <span>
          <a class="btn btn-sm variant-filled-secondary" href={'/dashboard/members/' + m.id}>
            <Fa icon={faGripLines} />
            <span>{$_('button.view')}</span>
          </a>
        </span>
      </li>
    {/if}
  {/each}
</ul>
