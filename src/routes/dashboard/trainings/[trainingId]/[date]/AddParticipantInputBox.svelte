<script lang="ts">
  import type { Member } from '$lib/models';
  import Fa from 'svelte-fa';
  import { faUserPlus } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  let { onadd }: { onadd?: (data: { member: Member }) => void } = $props();

  let searchterm = $state('');
  let showDropdown = $state(false);

  let filteredData: Member[] = $state([]);

  async function filterData(): Promise<void> {
    const text = searchterm;
    const { error, data } = await supabaseClient
      .from('view_search_members')
      .select('id, fullname, lastname, firstname')
      .like('fullname', `%${text}%`)
      .returns<Member[]>();
    if (error) {
      console.log(error);
    }
    if (data) filteredData = data;
    showDropdown = true;
  }

  function clearSearch() {
    searchterm = '';
    showDropdown = false;
  }

  function add(member: Member) {
    onadd?.({ member: member });
    clearSearch();
  }

  import MemberForm from './MemberForm.svelte';

  let showNewMemberForm = $state(false);
  let newMemberLastname = $state('');
  let newMemberFirstname = $state('');

  function createNewMember() {
    const s = searchterm.split(' ');
    if (s.length > 1) {
      newMemberLastname = s[0];
      newMemberFirstname = s.splice(1).join(' ');
    } else {
      newMemberLastname = searchterm;
      newMemberFirstname = '';
    }
    showDropdown = false;
    showNewMemberForm = true;
  }

  async function handleNewMemberSubmit(r: { lastname: string; firstname: string }) {
    const { error, data } = await supabaseClient
      .from('members')
      .insert({ ...r, labels: ['new'] })
      .select()
      .single();
    if (error) console.log(error);
    onadd?.({ member: data });
    clearSearch();
    showNewMemberForm = false;
  }
</script>

<div class="relative w-full">
  <div class="input-group input-group-divider grid-cols-[auto_1fr_auto]">
    <div class="input-group-shim">
      <Fa icon={faUserPlus} />
    </div>
    <input
      class="input"
      type="text"
      placeholder={$_('page.trainings.addMemberPlaceholder')}
      bind:value={searchterm}
      oninput={filterData}
      onfocus={() => {
        if (searchterm && filteredData.length > 0) showDropdown = true;
      }}
    />
  </div>
  {#if showDropdown && searchterm}
    <nav class="card p-2 shadow-xl absolute top-full left-0 right-0 z-50 mt-1">
      <ul class="nav-list">
        {#each filteredData as p (p.id)}
          <li>
            <span class="flex-auto">{p.lastname} {p.firstname}</span>
            <div class="justify-self-end relative">
              <button class="btn btn-sm preset-tonal-primary" onclick={() => add(p)}>
                <Fa icon={faUserPlus} />
                <span>{$_('button.add')}</span>
              </button>
            </div>
          </li>
        {/each}
        <li>
          <span class="flex-auto">{searchterm}...</span>
          <div class="justify-self-end relative">
            <button class="btn btn-sm preset-filled-primary-500" onclick={createNewMember}>
              {$_('button.createNew')}
            </button>
          </div>
        </li>
      </ul>
    </nav>
  {/if}

  {#if showNewMemberForm}
    <div class="card p-4 mt-2 border border-surface-300">
      <MemberForm
        lastname={newMemberLastname}
        firstname={newMemberFirstname}
        onclose={() => (showNewMemberForm = false)}
        onsubmit={handleNewMemberSubmit}
      />
    </div>
  {/if}
</div>
