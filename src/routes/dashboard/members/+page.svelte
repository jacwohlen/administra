<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faGripLines, faPlus } from '@fortawesome/free-solid-svg-icons';
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
      toaster.success({ title: $_('page.members.createdSuccess') });
    } catch (error) {
      console.error('Error creating member:', error);
      toaster.error({ title: $_('page.members.createError') });
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="flex items-center justify-between mb-4">
  <h1>{$_('page.members.title')}</h1>
  <button class="btn btn-sm preset-filled-primary-500" onclick={showMemberForm}>
    <Fa icon={faPlus} />
    <span>{$_('page.members.addMember')}</span>
  </button>
</div>

{#if showMemberFormDialog}
  <div class="card p-4 mb-4 border border-surface-300-700">
    <MemberForm
      {isSubmitting}
      onclose={() => (showMemberFormDialog = false)}
      onsubmit={addMember}
    />
  </div>
{/if}

<div class="m-2">
  <input
    class="input"
    bind:value={searchTerm}
    type="text"
    placeholder={$_('page.trainings.searchMembersPlaceholder')}
  />
</div>

<ul class="flex flex-col gap-3">
  {#each data.members as m (m.id)}
    {#if search(m.firstname, m.lastname)}
      <li class="card p-4 flex items-center">
        <span class="flex-auto">
          <dt class="font-bold">
            {m.lastname}
            {m.firstname}
          </dt>
          <dd class="text-xs">
            {#if m.labels}
              {#each m.labels as l (l)}
                <span class="truncate text-wrap">
                  <span class="badge preset-filled-secondary-500 font-normal h-4 m-0.5">{l}</span>
                </span>
              {/each}
            {/if}
          </dd>
        </span>
        <span>
          <a class="btn btn-sm preset-tonal-primary" href={'/dashboard/members/' + m.id}>
            <Fa icon={faGripLines} />
            <span>{$_('button.view')}</span>
          </a>
        </span>
      </li>
    {/if}
  {/each}
</ul>
