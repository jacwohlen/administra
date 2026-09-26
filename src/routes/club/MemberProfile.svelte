<script lang="ts">
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import MedalTally from '$lib/components/MedalTally.svelte';
  import MemberBadges from '$lib/components/MemberBadges.svelte';
  import MemberGrades from '$lib/components/MemberGrades.svelte';
  import MemberMedals from '$lib/components/MemberMedals.svelte';
  import { beltRingColor, highestGrade, medalTally } from '$lib/gradeUtils';
  import MemberLogs from '../dashboard/members/[memberId]/MemberLogs.svelte';
  import MemberAvatar from './MemberAvatar.svelte';
  import type { MemberProfileData } from './memberProfile';

  let { profile }: { profile: MemberProfileData } = $props();

  let member = $derived(profile.member);
  let topGrade = $derived(highestGrade(profile.currentGrades));
  let tally = $derived(medalTally(profile.medals));
  let details = $derived(profile.details);

  function formatBirthday(birthday?: string | null): string {
    if (!birthday) return '–';
    const d = dayjs(birthday);
    return d.isValid() ? d.format('DD.MM.YYYY') : birthday;
  }
</script>

<div class="space-y-4">
  <section class="card p-6 flex flex-col items-center text-center gap-3">
    <MemberAvatar
      src={profile.photo}
      firstname={member.firstname}
      lastname={member.lastname}
      size="lg"
      ringColor={topGrade ? beltRingColor(topGrade.beltColor) : null}
    />
    <div class="space-y-1">
      <h1 class="!m-0">{member.firstname} {member.lastname}</h1>
      {#if member.isMine}
        <span class="chip preset-tonal-primary text-xs">{$_('page.club.thatsYou')}</span>
      {/if}
    </div>
    {#if member.sections.length > 0}
      <div class="flex flex-wrap justify-center gap-1">
        {#each member.sections as section (section)}
          <span class="chip preset-tonal-secondary text-xs">{section}</span>
        {/each}
      </div>
    {/if}
    {#if profile.currentGrades.length > 0 || tally.total > 0}
      <div class="flex flex-col items-center gap-2">
        {#if profile.currentGrades.length > 0}
          <div class="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {#each profile.currentGrades as g (g.section)}
              <span class="inline-flex items-center gap-2 text-sm" title={g.grade}>
                <BeltStrip color={g.beltColor} isDan={g.isDan} />
                <span class="font-semibold">{g.grade}</span>
                <span class="text-surface-600-400">{g.section}</span>
              </span>
            {/each}
          </div>
        {/if}
        {#if tally.total > 0}
          <MedalTally {tally} />
        {/if}
      </div>
    {/if}
  </section>

  {#if details}
    <section class="card p-4">
      <h3>{$_('page.club.myDetails')}</h3>
      <dl class="space-y-2">
        <div class="flex flex-col sm:flex-row border-b border-surface-300-700 pb-2">
          <dt class="sm:w-32 text-surface-600-400">{$_('page.members.birthday')}</dt>
          <dd>{formatBirthday(details.birthday)}</dd>
        </div>
        <div class="flex flex-col sm:flex-row border-b border-surface-300-700 pb-2">
          <dt class="sm:w-32 text-surface-600-400">{$_('page.members.mobile')}</dt>
          <dd>{details.mobile || '–'}</dd>
        </div>
        <div class="flex flex-col sm:flex-row pb-2">
          <dt class="sm:w-32 text-surface-600-400">{$_('page.members.email')}</dt>
          <dd class="break-all">{details.email || '–'}</dd>
        </div>
      </dl>
      <p class="text-xs text-surface-600-400 mt-2">{$_('page.club.detailsHint')}</p>
    </section>
  {/if}

  <section class="card p-4">
    <MemberBadges
      badges={profile.badges}
      progress={profile.badgeProgress}
      definitions={profile.badgeDefinitions}
    />
  </section>

  <section class="card p-4">
    <MemberGrades
      memberId={member.id}
      current={profile.currentGrades}
      history={profile.gradeHistory}
      definitions={profile.gradeDefinitions}
      readonly
    />
  </section>

  {#if profile.medals.length > 0}
    <section class="card p-4">
      <MemberMedals memberId={member.id} medals={profile.medals} readonly />
    </section>
  {/if}

  {#if member.isMine}
    <MemberLogs memberId={String(member.id)} />
  {/if}
</div>
