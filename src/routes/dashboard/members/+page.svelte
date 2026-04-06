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
  <button class="btn btn-sm min-h-[44px] preset-filled-primary-500" onclick={showMemberForm}>
    <Fa icon={faPlus} />
    <span>{$_('page.members.addMember')}</span>
  </button>
</div>

{#if showMemberFormDialog}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    onclick={() => (showMemberFormDialog = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') showMemberFormDialog = false;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="card p-4 sm:p-6 w-full max-w-lg shadow-2xl bg-surface-50-950"
      onclick={(e) => e.stopPropagation()}
    >
      <h3 class="font-semibold text-lg mb-4">{$_('page.members.addMember')}</h3>
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
      <li class="flex items-center gap-3 py-2">
        <div
          class="size-10 rounded-full bg-surface-100-900 flex items-center justify-center text-sm font-bold flex-shrink-0"
        >
          {m.lastname.charAt(0)}{m.firstname.charAt(0)}
        </div>
        <span class="flex-auto min-w-0">
          <dt class="font-bold truncate">{m.lastname} {m.firstname}</dt>
          <dd class="flex flex-wrap gap-1">
            {#if m.labels}
              {#each m.labels as l (l)}
                <span class="chip preset-tonal-secondary text-xs">{l}</span>
              {/each}
            {/if}
          </dd>
        </span>
        <a
          class="btn btn-sm min-h-[44px] preset-tonal-primary flex-shrink-0"
          href={'/dashboard/members/' + m.id}
        >
          <Fa icon={faGripLines} />
          <span class="hidden sm:inline">{$_('button.view')}</span>
        </a>
      </li>
    {/if}
  {/each}
</ul>
