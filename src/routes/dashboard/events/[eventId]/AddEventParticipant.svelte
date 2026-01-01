<script lang="ts">
  import type { Member } from '$lib/models';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faUserPlus } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  export let eventId: string;
  export let existingParticipants: string[] = []; // Array of member IDs already registered

  let searchterm = '';
  let filteredData: Member[] = [];
  let loading = false;
  let selectedIndex = -1; // For keyboard navigation

  async function filterData(): Promise<void> {
    if (searchterm.trim().length < 2) {
      filteredData = [];
      selectedIndex = -1;
      return;
    }

    const text = searchterm;

    const { error, data } = await supabaseClient
      .from('view_search_members')
      .select('id, fullname, lastname, firstname')
      .like('fullname', `%${text}%`)
      .returns<Member[]>();

    if (error) {
      console.error('Search error:', error);
      return;
    }

    if (data) {
      // Filter out already registered participants
      filteredData = data.filter((member) => !existingParticipants.includes(member.id));
      // Reset selected index when new results come in
      selectedIndex = filteredData.length > 0 ? 0 : -1;
    }
  }

  function clearSearch() {
    searchterm = '';
    filteredData = [];
    selectedIndex = -1;
  }

  // Keyboard navigation
  function handleKeydown(event: KeyboardEvent) {
    if (filteredData.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectedIndex = selectedIndex < filteredData.length - 1 ? selectedIndex + 1 : 0;
        break;
      case 'ArrowUp':
        event.preventDefault();
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : filteredData.length - 1;
        break;
      case 'Enter':
        event.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < filteredData.length) {
          addParticipant(filteredData[selectedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        clearSearch();
        break;
    }
  }

  const dispatch = createEventDispatcher();

  async function addParticipant(member: Member) {
    loading = true;
    try {
      const { error } = await supabaseClient.from('event_participants').insert({
        eventId: eventId,
        memberId: member.id,
        attendanceStatus: 'registered'
      });

      if (error) {
        console.error('Error adding participant:', error);
        return;
      }

      dispatch('added', { member });
      clearSearch();
    } finally {
      loading = false;
    }
  }
</script>

<div class="relative w-full">
  <div class="input-group input-group-divider grid-cols-[auto_1fr]">
    <div class="input-group-shim">
      <Fa icon={faUserPlus} />
    </div>
    <input
      class="input"
      type="text"
      placeholder={$_('page.events.search_members_placeholder')}
      bind:value={searchterm}
      on:input={filterData}
      on:keydown={handleKeydown}
      disabled={loading}
    />
  </div>

  {#if searchterm.length >= 2}
    <div class="absolute top-full left-0 right-0 z-50 mt-1">
      <div class="card p-2 shadow-xl bg-white">
        {#if filteredData.length > 0}
          <div class="space-y-1">
            {#each filteredData as member, index (member.id)}
              <div
                class="flex items-center justify-between p-2 rounded cursor-pointer {index ===
                selectedIndex
                  ? 'bg-primary-100 border-primary-300'
                  : 'hover:bg-gray-100'}"
                on:click={() => addParticipant(member)}
                on:keydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    addParticipant(member);
                  }
                }}
                role="button"
                tabindex="0"
              >
                <span>{member.lastname}, {member.firstname}</span>
                <button
                  class="btn btn-sm variant-ringed-primary"
                  on:click|stopPropagation={() => addParticipant(member)}
                  disabled={loading}
                >
                  <Fa icon={faUserPlus} />
                  <span>{$_('button.add')}</span>
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <div class="p-2 text-sm text-gray-500">
            {$_('page.trainings.memberNotFound')}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
