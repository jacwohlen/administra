<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft, faCodeMerge } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { invalidate } from '$app/navigation';
  import MergeMemberDialog from '../[memberId]/MergeMemberDialog.svelte';
  import type { MergeMember } from '$lib/memberMerge';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let merging = $state<{ keep: MergeMember; drop: MergeMember } | null>(null);

  function describe(m: MergeMember) {
    return [
      `#${m.id}`,
      m.birthday ? dayjs(m.birthday).format('DD.MM.YYYY') : null,
      m.email ?? null,
      m.membership_status ? $_(`page.members.status.${m.membership_status}`) : null,
      m.archivedAt ? $_('page.members.status.archived') : null
    ]
      .filter(Boolean)
      .join(' · ');
  }
</script>

<div class="space-y-4">
  <div class="page-header-back">
    <a
      href="/dashboard/members"
      class="btn preset-tonal-surface"
      title={$_('page.members.backToList')}
      aria-label={$_('page.members.backToList')}
    >
      <Fa icon={faArrowLeft} />
    </a>
    <h1 class="flex-1 min-w-0 truncate">{$_('page.members.duplicates.title')}</h1>
  </div>
  <p class="text-sm">{$_('page.members.duplicates.intro')}</p>

  {#if data.pairs.length === 0}
    <p class="text-surface-600-400">{$_('page.members.duplicates.empty')}</p>
  {:else}
    <p class="text-sm text-surface-600-400">
      {$_('page.members.duplicates.count', { values: { count: data.pairs.length } })}
    </p>
    <ul class="space-y-2">
      {#each data.pairs as pair (`${pair.keep.id}-${pair.drop.id}`)}
        <li class="card p-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div class="flex-1 min-w-0 space-y-1">
            {#each [pair.keep, pair.drop] as m (m.id)}
              <div class="min-w-0">
                <a href="/dashboard/members/{m.id}" class="anchor font-semibold">
                  {m.firstname}
                  {m.lastname}
                </a>
                <span class="text-xs text-surface-600-400">{describe(m)}</span>
              </div>
            {/each}
            <div class="flex flex-wrap gap-1">
              {#each pair.reasons as reason (reason)}
                <span class="chip preset-tonal-surface text-xs">
                  {$_(`page.members.duplicates.reason.${reason}`)}
                </span>
              {/each}
            </div>
          </div>
          {#if pair.blocked}
            <span class="text-sm text-surface-600-400">
              {$_('page.members.duplicates.mergeInProvider', { values: { provider: 'Webling' } })}
            </span>
          {:else}
            <button
              type="button"
              class="btn preset-tonal-primary"
              onclick={() => (merging = { keep: pair.keep, drop: pair.drop })}
            >
              <Fa icon={faCodeMerge} />
              <span>{$_('page.members.duplicates.merge')}</span>
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if merging}
  <MergeMemberDialog
    first={merging.keep}
    second={merging.drop}
    onclose={() => (merging = null)}
    onmerged={() => {
      // Stay on the list for the next pair
      merging = null;
      invalidate('members:list');
    }}
  />
{/if}
