<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faChevronRight, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import { beltRingColor } from '$lib/gradeUtils';
  import MemberAvatar from '../MemberAvatar.svelte';
  import { directorySections, filterDirectory } from './directory';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let query = $state('');
  let section: string | null = $state(null);

  let sections = $derived(directorySections(data.members));
  let visible = $derived(filterDirectory(data.members, query, section));
</script>

<svelte:head>
  <title>{$_('page.club.members')}</title>
</svelte:head>

<div class="space-y-3">
  <div class="flex items-baseline justify-between gap-2">
    <h1 class="!m-0">{$_('page.club.members')}</h1>
    <span class="text-sm text-surface-600-400">
      {$_('page.club.memberCount', { values: { count: visible.length } })}
    </span>
  </div>

  <label class="relative block">
    <span class="sr-only">{$_('page.club.searchPlaceholder')}</span>
    <span class="absolute inset-y-0 left-3 flex items-center text-surface-600-400">
      <Fa icon={faMagnifyingGlass} />
    </span>
    <input
      class="input pl-10"
      type="search"
      placeholder={$_('page.club.searchPlaceholder')}
      bind:value={query}
    />
  </label>

  {#if sections.length > 1}
    <div class="flex flex-wrap gap-2" role="group" aria-label={$_('page.club.filterSection')}>
      <button
        type="button"
        class="chip {section === null ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
        aria-pressed={section === null}
        onclick={() => (section = null)}
      >
        {$_('page.club.allSections')}
      </button>
      {#each sections as s (s)}
        <button
          type="button"
          class="chip {section === s ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
          aria-pressed={section === s}
          onclick={() => (section = section === s ? null : s)}
        >
          {s}
        </button>
      {/each}
    </div>
  {/if}

  {#if visible.length === 0}
    <p class="empty-state">{$_('page.club.noMatches')}</p>
  {:else}
    <ul class="card border border-surface-200-800 divide-y divide-surface-200-800 overflow-hidden">
      {#each visible as m (m.id)}
        <li>
          <a
            href="/club/members/{m.id}"
            class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-100-900 transition-colors"
          >
            <MemberAvatar
              src={m.img}
              firstname={m.firstname}
              lastname={m.lastname}
              ringColor={m.topGrade ? beltRingColor(m.topGrade.beltColor) : null}
            />
            <div class="flex-1 min-w-0">
              <p class="font-semibold truncate">
                {m.firstname}
                {m.lastname}
                {#if m.topBadge}<span class="ml-1">{m.topBadge}</span>{/if}
                {#if m.isMine}
                  <span class="chip preset-tonal-primary text-xs ml-1 align-middle"
                    >{$_('page.users.you')}</span
                  >
                {/if}
              </p>
              <p class="text-sm text-surface-600-400 flex items-center gap-2 min-w-0">
                {#if m.topGrade}
                  <BeltStrip
                    color={m.topGrade.beltColor}
                    isDan={m.topGrade.isDan}
                    grade={m.topGrade.grade}
                    size="sm"
                  />
                  <span class="truncate">{m.topGrade.grade}</span>
                  {#if m.sections.length > 0}<span aria-hidden="true">·</span>{/if}
                {/if}
                <span class="truncate">{m.sections.join(', ')}</span>
              </p>
            </div>
            <Fa icon={faChevronRight} class="text-surface-400-600 flex-none" />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
