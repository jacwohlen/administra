<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import MemberProfile from '../../MemberProfile.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.profile.member.firstname} {data.profile.member.lastname}</title>
</svelte:head>

<a href="/club/members" class="btn btn-sm preset-tonal-surface mb-3">
  <Fa icon={faArrowLeft} />
  <span>{$_('page.club.backToMembers')}</span>
</a>

<MemberProfile profile={data.profile} />
