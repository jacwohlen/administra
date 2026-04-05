<script lang="ts">
  import type { Member } from '$lib/models';
  import Fa from 'svelte-fa';
  import { faUserPlus } from '@fortawesome/free-solid-svg-icons';
  import {
    popup,
    type PopupSettings,
    getModalStore,
    type ModalComponent,
    type ModalSettings
  } from '@skeletonlabs/skeleton';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  const modalStore = getModalStore();

  const popupSettings: PopupSettings = {
    event: 'focus-click',
    target: 'menu1',
    placement: 'bottom'
  };

  let { onadd }: { onadd?: (data: { member: Member }) => void } = $props();

  let searchterm = $state('');

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
  }

  function clearSearch() {
    searchterm = '';
  }

  function add(member: Member) {
    onadd?.({ member: member });
    clearSearch();
  }

  import MemberForm from './MemberForm.svelte';
  function createNewMember() {
    const s = searchterm.split(' ');
    let lastname = '';
    let firstname = '';
    if (s.length > 1) {
      lastname = s[0];
      firstname = s.splice(1).join(' ');
    } else {
      lastname = searchterm;
    }

    const modalComponent: ModalComponent = {
      ref: MemberForm,
      props: { lastname, firstname }
    };

    const d: ModalSettings = {
      type: 'component',
      component: modalComponent,
      response: async (r) => {
        const { error, data } = await supabaseClient
          .from('members')
          .insert({ ...r, labels: ['new'] })
          .select()
          .single();
        if (error) console.log(error);
        onadd?.({ member: data });
        clearSearch();
      }
    };
    modalStore.trigger(d);
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
      use:popup={popupSettings}
    />
  </div>
  <nav class="card p-2 shadow-xl" data-popup="menu1">
    <ul class="nav-list">
      {#each filteredData as p (p.id)}
        <li>
          <span class="flex-auto">{p.lastname} {p.firstname}</span>
          <div class="justify-self-end relative">
            <button class="btn btn-sm variant-ringed-primary" onclick={() => add(p)}>
              <Fa icon={faUserPlus} />
              <span>{$_('button.add')}</span>
            </button>
          </div>
        </li>
      {/each}
      <li>
        <span class="flex-auto">{searchterm}...</span>
        <div class="justify-self-end relative">
          <button class="btn btn-sm variant-filled-primary" onclick={createNewMember}>
            {$_('button.createNew')}
          </button>
        </div>
      </li>
    </ul>
  </nav>
</div>
