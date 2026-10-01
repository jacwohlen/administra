<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import ClubProfile from '../../ClubProfile.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.profile.member.firstname} {data.profile.member.lastname}</title>
</svelte:head>

<div class="page-header-back">
  <a
    href="/club/members"
    class="btn preset-tonal-surface"
    title={$_('page.members.backToList')}
    aria-label={$_('page.members.backToList')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <span class="text-surface-600-400">{$_('page.club.members')}</span>
</div>

<ClubProfile profile={data.profile} />
