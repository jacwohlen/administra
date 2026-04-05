<script lang="ts">
  import type { Member } from '$lib/models';
  import Fa from 'svelte-fa';
  import { faUserPlus } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import MemberForm from './MemberForm.svelte';

  let { onadd }: { onadd?: (data: { member: Member }) => void } = $props();

  let searchterm = $state('');
  let filteredData: Member[] = $state([]);
  let selectedIndex = $state(-1);
  let loading = $state(false);
  let showNewMemberForm = $state(false);
  let newMemberLastname = $state('');
  let newMemberFirstname = $state('');

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
      filteredData = data;
      selectedIndex = filteredData.length > 0 ? 0 : -1;
    }
  }

  function clearSearch() {
    searchterm = '';
    filteredData = [];
    selectedIndex = -1;
  }

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
          add(filteredData[selectedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        clearSearch();
        break;
    }
  }

  function add(member: Member) {
    onadd?.({ member });
    clearSearch();
  }

  function createNewMember() {
    const s = searchterm.split(' ');
    if (s.length > 1) {
      newMemberLastname = s[0];
      newMemberFirstname = s.splice(1).join(' ');
    } else {
      newMemberLastname = searchterm;
      newMemberFirstname = '';
    }
    filteredData = [];
    showNewMemberForm = true;
  }

  async function handleNewMemberSubmit(r: { lastname: string; firstname: string }) {
    loading = true;
    try {
      const { error, data } = await supabaseClient
        .from('members')
        .insert({ ...r, labels: ['new'] })
        .select()
        .single();
      if (error) console.error(error);
      onadd?.({ member: data });
      clearSearch();
      showNewMemberForm = false;
    } finally {
      loading = false;
    }
  }
</script>

<div class="relative w-full">
  <div class="input-group grid-cols-[auto_1fr]">
    <div class="ig-cell">
      <Fa icon={faUserPlus} />
    </div>
    <input
      class="input"
      type="text"
      placeholder={$_('page.trainings.addMemberPlaceholder')}
      bind:value={searchterm}
      oninput={filterData}
      onkeydown={handleKeydown}
      disabled={loading}
    />
  </div>

  {#if searchterm.length >= 2}
    <div class="absolute bottom-full left-0 right-0 z-50 mb-1">
      <div class="card p-2 shadow-xl bg-surface-50-950 max-h-64 overflow-y-auto">
        {#if filteredData.length > 0}
          <div class="space-y-1">
            {#each filteredData as p, index (p.id)}
              <div
                class="flex items-center justify-between p-2 rounded cursor-pointer {index ===
                selectedIndex
                  ? 'bg-primary-100-900'
                  : 'hover:bg-surface-100-900'}"
                onclick={() => add(p)}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    add(p);
                  }
                }}
              >
                <span>{p.lastname} {p.firstname}</span>
                <button
                  class="btn btn-sm preset-tonal-primary"
                  onclick={(e) => {
                    e.stopPropagation();
                    add(p);
                  }}
                  disabled={loading}
                >
                  <Fa icon={faUserPlus} />
                  <span>{$_('button.add')}</span>
                </button>
              </div>
            {/each}
          </div>
          <div class="border-t border-surface-300-700 mt-2 pt-2">
            <button class="btn btn-sm preset-filled-primary-500 w-full" onclick={createNewMember}>
              <Fa icon={faUserPlus} />
              <span>{$_('button.createNew')}: "{searchterm}"</span>
            </button>
          </div>
        {:else}
          <div class="p-2 text-sm text-surface-600-400">
            {$_('page.trainings.memberNotFound')}
          </div>
          <div class="border-t border-surface-300-700 mt-2 pt-2">
            <button class="btn btn-sm preset-filled-primary-500 w-full" onclick={createNewMember}>
              <Fa icon={faUserPlus} />
              <span>{$_('button.createNew')}: "{searchterm}"</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if showNewMemberForm}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    onclick={() => (showNewMemberForm = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') showNewMemberForm = false;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="card p-6 w-full max-w-lg shadow-2xl bg-surface-50-950"
      onclick={(e) => e.stopPropagation()}
    >
      <h3 class="font-semibold text-lg mb-4">{$_('button.createNew')}</h3>
      <MemberForm
        lastname={newMemberLastname}
        firstname={newMemberFirstname}
        onclose={() => (showNewMemberForm = false)}
        onsubmit={handleNewMemberSubmit}
      />
    </div>
  </div>
{/if}
