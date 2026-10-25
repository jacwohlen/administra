<script lang="ts">
  import { modalDialog } from '$lib/modalDialog';
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faChevronRight, faPlus } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidate } from '$app/navigation';
  import MemberForm from './MemberForm.svelte';

  let { data }: { data: PageData } = $props();
  let searchTerm = $state('');
  let isSubmitting = false;
  let showMemberFormDialog = $state(false);

  let search = $derived((firstname: string, lastname: string): boolean => {
    let q = searchTerm.toLowerCase().trim();
    let firstlast = firstname.toLowerCase() + ' ' + lastname.toLowerCase();
    let lastfirst = lastname.toLowerCase() + ' ' + firstname.toLowerCase();
    return firstlast.startsWith(q) || lastfirst.startsWith(q);
  });

  function showMemberForm() {
    showMemberFormDialog = true;
  }

  async function addMember(
    result:
      | {
          id?: string;
          firstname: string;
          lastname: string;
          birthday?: string;
          mobile?: string;
          email?: string;
          notes?: string;
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
        email: memberData.email || null,
        notes: memberData.notes || null,
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
      toaster.success({ title: $_('page.members.createdSuccess') });
    } catch (error) {
      console.error('Error creating member:', error);
      toaster.error({ title: $_('page.members.createError') });
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="page-header">
  <h1>{$_('page.members.title')}</h1>
  {#if data.canWrite}
    <button class="btn preset-filled-primary-500" onclick={showMemberForm}>
      <Fa icon={faPlus} />
      <span>{$_('page.members.addMember')}</span>
    </button>
  {/if}
</div>

{#if showMemberFormDialog}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (showMemberFormDialog = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') showMemberFormDialog = false;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      use:modalDialog
      class="card modal-dialog modal-dialog-lg"
      onclick={(e) => e.stopPropagation()}
    >
      <h3>{$_('page.members.addMember')}</h3>
      <MemberForm
        {isSubmitting}
        onclose={() => (showMemberFormDialog = false)}
        onsubmit={addMember}
      />
    </div>
  </div>
{/if}

<div class="mb-4">
  <input
    class="input"
    bind:value={searchTerm}
    type="text"
    placeholder={$_('page.trainings.searchMembersPlaceholder')}
  />
</div>

<ul class="flex flex-col gap-2">
  {#each data.members as m (m.id)}
    {#if search(m.firstname, m.lastname)}
      <li>
        <a href={'/dashboard/members/' + m.id} class="list-item list-item-link">
          <div class="relative inline-block flex-shrink-0">
            <div class="avatar-initials">
              {m.lastname.charAt(0)}{m.firstname.charAt(0)}
            </div>
          </div>
          <span class="list-item-content">
            <dt class="font-bold truncate">
              {m.lastname}
              {m.firstname}{#if data.badgeMap[m.id]}<span
                  class="ml-1 inline-block text-base leading-none align-middle"
                  >{data.badgeMap[m.id]}</span
                >{/if}
            </dt>
            <dd class="flex flex-wrap gap-1">
              {#if m.labels}
                {#each m.labels as l (l)}
                  <span class="chip preset-tonal-secondary text-xs">{l}</span>
                {/each}
              {/if}
            </dd>
          </span>
          <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
        </a>
      </li>
    {/if}
  {/each}
</ul>
{#if !data.members.some((m) => search(m.firstname, m.lastname))}
  <p class="empty-state">
    {searchTerm.trim() ? $_('page.members.noResults') : $_('page.members.empty')}
  </p>
{/if}
