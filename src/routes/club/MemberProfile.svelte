<script lang="ts">
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import Fa from 'svelte-fa';
  import { faCakeCandles, faEnvelope, faPhone } from '@fortawesome/free-solid-svg-icons';
  import ActivityOverview from '$lib/components/ActivityOverview.svelte';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import MedalTally from '$lib/components/MedalTally.svelte';
  import MemberBadges from '$lib/components/MemberBadges.svelte';
  import MemberGrades from '$lib/components/MemberGrades.svelte';
  import MemberMedals from '$lib/components/MemberMedals.svelte';
  import { beltRingColor, highestGrade, medalTally } from '$lib/gradeUtils';
  import { calculateAge } from '$lib/utils';
  import MemberLogs from '../dashboard/members/[memberId]/MemberLogs.svelte';
  import type { MemberProfileData } from './memberProfile';

  // Read-only counterpart of /dashboard/members/[memberId]: same layout (the club
  // area uses the dashboard's page width so both render identically), no
  // editing, and contact data / attendance only for the member's own profile.
  let { profile }: { profile: MemberProfileData } = $props();

  let member = $derived(profile.member);
  let details = $derived(profile.details);
  let topGrade = $derived(highestGrade(profile.currentGrades));
  let ringColor = $derived(topGrade ? beltRingColor(topGrade.beltColor) : null);
  let tally = $derived(medalTally(profile.medals));
  let age = $derived(calculateAge(details?.birthday ?? undefined));
  let photoFailed = $state(false);
</script>

<div class="space-y-4">
  <!-- Profile hero -->
  <section class="card border border-surface-200-800 overflow-hidden">
    <div class="h-20 sm:h-24 bg-linear-to-r from-primary-500/30 to-tertiary-500/20"></div>
    <div class="px-4 pt-2 pb-4">
      <div class="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 sm:-mt-14">
        <div
          class="rounded-full self-center sm:self-auto flex-none"
          style:box-shadow={ringColor
            ? `0 0 0 3px var(--color-surface-50-950), 0 0 0 7px ${ringColor}`
            : '0 0 0 4px var(--color-surface-50-950)'}
          title={topGrade ? `${topGrade.grade} ${topGrade.section}` : undefined}
        >
          {#if profile.photo && !photoFailed}
            <img
              src={profile.photo}
              alt="{member.firstname} {member.lastname}"
              class="size-24 sm:size-28 rounded-full object-cover"
              onerror={() => (photoFailed = true)}
            />
          {:else}
            <div
              class="size-24 sm:size-28 rounded-full bg-surface-200-800 flex items-center justify-center text-3xl font-bold"
            >
              {member.firstname.charAt(0)}{member.lastname.charAt(0)}
            </div>
          {/if}
        </div>

        <div class="flex-1 min-w-0 text-center sm:text-left">
          <h1 class="truncate">{member.firstname} {member.lastname}</h1>
          <p class="text-sm text-surface-600-400 tabular-nums">
            {#if member.isMine}
              <span class="chip preset-tonal-primary text-xs align-middle"
                >{$_('page.club.thatsYou')}</span
              >
            {/if}
            {#if age !== null}
              {$_('page.members.age', { values: { age } })}
            {/if}
          </p>
        </div>
      </div>

      {#if member.sections.length > 0}
        <div class="flex flex-wrap justify-center sm:justify-start gap-1 mt-3">
          {#each member.sections as section (section)}
            <span class="chip preset-tonal-secondary text-xs">{section}</span>
          {/each}
        </div>
      {/if}

      {#if member.isMine}
        <div class="mt-4 pt-4 border-t border-surface-200-800">
          <ActivityOverview memberId={member.id} />
        </div>
      {/if}

      {#if profile.currentGrades.length > 0 || tally.total > 0}
        <div
          class="flex flex-wrap items-center justify-center sm:justify-between gap-3 mt-4 pt-4 border-t border-surface-200-800"
        >
          {#if profile.currentGrades.length > 0}
            <div class="flex flex-wrap justify-center gap-x-4 gap-y-1">
              {#each profile.currentGrades as g (g.section)}
                <span class="inline-flex items-center gap-2 text-sm" title={g.grade}>
                  <BeltStrip color={g.beltColor} isDan={g.isDan} grade={g.grade} />
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
    </div>
  </section>

  <!-- Contact (own profile only) -->
  {#if details}
    <section class="space-y-1">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {#snippet contactTile(icon: typeof faPhone, label: string, value?: string | null)}
          <div class="card border border-surface-200-800 p-3 flex items-center gap-3 min-w-0">
            <div class="entity-badge text-primary-600-400"><Fa {icon} /></div>
            <div class="min-w-0">
              <div class="text-xs text-surface-600-400">{label}</div>
              <div class="truncate" class:text-surface-600-400={!value}>{value || '–'}</div>
            </div>
          </div>
        {/snippet}
        {@render contactTile(faPhone, $_('page.members.mobile'), details.mobile)}
        {@render contactTile(faEnvelope, $_('page.members.email'), details.email)}
        {@render contactTile(
          faCakeCandles,
          $_('page.members.birthday'),
          details.birthday ? dayjs(details.birthday).format('DD.MM.YYYY') : null
        )}
      </div>
      <p class="text-xs text-surface-600-400 px-1">{$_('page.club.detailsHint')}</p>
    </section>
  {/if}

  <!-- Achievements -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <section class="card border border-surface-200-800 p-4">
      <MemberGrades
        memberId={member.id}
        current={profile.currentGrades}
        history={profile.gradeHistory}
        definitions={profile.gradeDefinitions}
        readonly
      />
    </section>
    <section class="card border border-surface-200-800 p-4">
      <MemberMedals memberId={member.id} medals={profile.medals} readonly />
    </section>
  </div>
  <section class="card border border-surface-200-800 p-4">
    <MemberBadges
      badges={profile.badges}
      progress={profile.badgeProgress}
      definitions={profile.badgeDefinitions}
    />
  </section>

  <!-- Attendance (own profile only) -->
  {#if member.isMine}
    <MemberLogs memberId={String(member.id)} />
  {/if}
</div>
