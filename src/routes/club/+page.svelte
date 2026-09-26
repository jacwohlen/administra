<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faUsers } from '@fortawesome/free-solid-svg-icons';
  import MemberAvatar from './MemberAvatar.svelte';
  import MemberProfile from './MemberProfile.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{$_('page.club.myProfile')}</title>
</svelte:head>

{#if data.myMembers.length > 1}
  <nav class="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1" aria-label={$_('page.club.pickProfile')}>
    {#each data.myMembers as m (m.id)}
      {@const active = data.profile?.member.id === m.id}
      <a
        href="/club?m={m.id}"
        class="flex items-center gap-2 rounded-full pl-1 pr-4 py-1 flex-none border transition-colors {active
          ? 'border-primary-500 bg-primary-50-950'
          : 'border-surface-300-700 hover:bg-surface-100-900'}"
        aria-current={active ? 'page' : undefined}
      >
        <MemberAvatar src={m.img} firstname={m.firstname} lastname={m.lastname} />
        <span class="font-semibold">{m.firstname}</span>
      </a>
    {/each}
  </nav>
{/if}

{#if data.profile}
  <MemberProfile profile={data.profile} />
{:else}
  <div class="card p-8 text-center space-y-4">
    <p class="text-4xl" aria-hidden="true">👋</p>
    <h1>{$_('page.club.noProfileTitle')}</h1>
    <p class="text-surface-600-400">{$_('page.club.noProfileMessage')}</p>
    <a href="/club/members" class="btn preset-filled-primary-500">
      <Fa icon={faUsers} />
      <span>{$_('page.club.browseMembers')}</span>
    </a>
  </div>
{/if}
