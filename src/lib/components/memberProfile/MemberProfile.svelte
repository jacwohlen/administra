<script lang="ts">
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import Fa from 'svelte-fa';
  import { faCakeCandles, faEnvelope, faPhone } from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';
  import ActivityOverview from '$lib/components/ActivityOverview.svelte';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import MedalTally from '$lib/components/MedalTally.svelte';
  import MemberBadges from '$lib/components/MemberBadges.svelte';
  import MemberGrades from '$lib/components/MemberGrades.svelte';
  import MemberMedals from '$lib/components/MemberMedals.svelte';
  import { beltRingColor, highestGrade, medalTally } from '$lib/gradeUtils';
  import type { MemberAchievements, PastEvent, PrivateDetails } from '$lib/models';
  import { calculateAge } from '$lib/utils';
  import MemberLogs from './MemberLogs.svelte';

  // The one member profile, shown to staff (/dashboard/members/[id]) and in
  // the club area (/club). Every viewer gets the same layout; the props only
  // switch sections and edit controls on or off.
  let {
    id,
    firstname,
    lastname,
    photo,
    tags = [],
    isMine = false,
    showId = false,
    details = null,
    detailsHint = false,
    notes = null,
    showAttendance = false,
    achievements,
    editing = null,
    photoAction
  }: {
    id: number;
    firstname: string;
    lastname: string;
    photo: string | null;
    /** Chips under the name: training sections (club) or labels (staff) */
    tags?: string[];
    /** Mark the profile as the viewer's own ("That's you") */
    isMine?: boolean;
    /** Show the member number next to the age (staff) */
    showId?: boolean;
    /** Contact tiles; null hides them (other members' profiles) */
    details?: PrivateDetails | null;
    /** Explain under the contact tiles who maintains them (club area) */
    detailsHint?: boolean;
    notes?: string | null;
    /** Activity grid and attendance log */
    showAttendance?: boolean;
    achievements: MemberAchievements;
    /** Grades and medals become editable (staff with write access) */
    editing?: { events: PastEvent[]; onchanged: () => void } | null;
    /** Controls placed on the avatar, e.g. the staff photo menu */
    photoAction?: Snippet;
  } = $props();

  let topGrade = $derived(highestGrade(achievements.currentGrades));
  let ringColor = $derived(topGrade ? beltRingColor(topGrade.beltColor) : null);
  let tally = $derived(medalTally(achievements.medals));
  let gradeSections = $derived([...new Set(achievements.gradeDefinitions.map((d) => d.section))]);
  let age = $derived(calculateAge(details?.birthday ?? undefined));

  // Remember which photo failed to load, so another member's photo is tried again
  let failedPhoto = $state<string | null>(null);
  let showPhoto = $derived(!!photo && photo !== failedPhoto);
</script>

<div class="space-y-4">
  <!-- Profile hero -->
  <section class="card border border-surface-200-800 overflow-hidden">
    <div class="h-20 sm:h-24 bg-linear-to-r from-primary-500/30 to-tertiary-500/20"></div>
    <div class="px-4 pt-2 pb-4">
      <div class="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 sm:-mt-14">
        <!-- Avatar -->
        <div class="relative self-center sm:self-auto flex-none">
          <div
            class="rounded-full"
            style:box-shadow={ringColor
              ? `0 0 0 3px var(--color-surface-50-950), 0 0 0 7px ${ringColor}`
              : '0 0 0 4px var(--color-surface-50-950)'}
            title={topGrade ? `${topGrade.grade} ${topGrade.section}` : undefined}
          >
            {#if showPhoto}
              <img
                src={photo}
                alt="{firstname} {lastname}"
                class="size-24 sm:size-28 rounded-full object-cover"
                onerror={() => (failedPhoto = photo)}
              />
            {:else}
              <div
                class="size-24 sm:size-28 rounded-full bg-surface-200-800 flex items-center justify-center text-3xl font-bold"
              >
                {firstname.charAt(0)}{lastname.charAt(0)}
              </div>
            {/if}
          </div>
          {@render photoAction?.()}
        </div>

        <!-- Name -->
        <div class="flex-1 min-w-0 text-center sm:text-left">
          <h1 class="truncate">{firstname} {lastname}</h1>
          <p class="text-sm text-surface-600-400 tabular-nums">
            {#if isMine}
              <span class="chip preset-tonal-primary text-xs align-middle"
                >{$_('page.club.thatsYou')}</span
              >
            {/if}
            {#if showId}#{id}{/if}
            {#if showId && age !== null}&middot;{/if}
            {#if age !== null}{$_('page.members.age', { values: { age } })}{/if}
          </p>
        </div>
      </div>

      {#if tags.length > 0}
        <div class="flex flex-wrap justify-center sm:justify-start gap-1 mt-3">
          {#each tags as tag (tag)}
            <span class="chip preset-tonal-secondary text-xs">{tag}</span>
          {/each}
        </div>
      {/if}

      {#if showAttendance}
        <div class="mt-4 pt-4 border-t border-surface-200-800">
          <ActivityOverview memberId={id} />
        </div>
      {/if}

      {#if achievements.currentGrades.length > 0 || tally.total > 0}
        <div
          class="flex flex-wrap items-center justify-center sm:justify-between gap-3 mt-4 pt-4 border-t border-surface-200-800"
        >
          {#if achievements.currentGrades.length > 0}
            <div class="flex flex-wrap justify-center gap-x-4 gap-y-1">
              {#each achievements.currentGrades as g (g.section)}
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

  <!-- Contact -->
  {#if details}
    <section class="space-y-1">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {#snippet contactTile(
          icon: typeof faPhone,
          label: string,
          value?: string | null,
          href?: string
        )}
          <div class="card border border-surface-200-800 p-3 flex items-center gap-3 min-w-0">
            <div class="entity-badge text-primary-600-400"><Fa {icon} /></div>
            <div class="min-w-0">
              <div class="text-xs text-surface-600-400">{label}</div>
              {#if value && href}
                <a {href} class="anchor block truncate">{value}</a>
              {:else}
                <div class="truncate" class:text-surface-600-400={!value}>{value || '–'}</div>
              {/if}
            </div>
          </div>
        {/snippet}
        {@render contactTile(
          faPhone,
          $_('page.members.mobile'),
          details.mobile,
          details.mobile ? `tel:${details.mobile.replace(/\s+/g, '')}` : undefined
        )}
        {@render contactTile(
          faEnvelope,
          $_('page.members.email'),
          details.email,
          details.email ? `mailto:${details.email}` : undefined
        )}
        {@render contactTile(
          faCakeCandles,
          $_('page.members.birthday'),
          details.birthday ? dayjs(details.birthday).format('DD.MM.YYYY') : null
        )}
      </div>
      {#if detailsHint}
        <p class="text-xs text-surface-600-400 px-1">{$_('page.club.detailsHint')}</p>
      {/if}
    </section>
  {/if}

  {#if notes}
    <section class="card border border-surface-200-800 p-4">
      <h3 class="text-sm! font-semibold text-surface-600-400 mb-1!">{$_('page.members.notes')}</h3>
      <p class="whitespace-pre-wrap">{notes}</p>
    </section>
  {/if}

  <!-- Achievements -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <section class="card border border-surface-200-800 p-4">
      <MemberGrades
        memberId={id}
        current={achievements.currentGrades}
        history={achievements.gradeHistory}
        definitions={achievements.gradeDefinitions}
        onchanged={editing?.onchanged}
        readonly={!editing}
      />
    </section>
    <section class="card border border-surface-200-800 p-4">
      <MemberMedals
        memberId={id}
        medals={achievements.medals}
        events={editing?.events}
        sections={gradeSections}
        onchanged={editing?.onchanged}
        readonly={!editing}
      />
    </section>
  </div>
  <section class="card border border-surface-200-800 p-4">
    <MemberBadges
      badges={achievements.badges}
      progress={achievements.badgeProgress}
      definitions={achievements.badgeDefinitions}
    />
  </section>

  <!-- Attendance -->
  {#if showAttendance}
    <MemberLogs memberId={String(id)} />
  {/if}
</div>
