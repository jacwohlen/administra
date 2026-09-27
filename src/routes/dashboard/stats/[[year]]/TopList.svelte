<script lang="ts">
  import type { Athletes } from '$lib/models';
  import { supabaseClient } from '$lib/supabase';
  import { faAngleRight } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { _ } from 'svelte-i18n';

  /** Podium for the top three of a section, followed by places 4 to 10. */
  let { section, entries, href }: { section: string; entries: Athletes[]; href: string } = $props();

  let images: Record<number, string | null> = $state({});

  $effect(() => {
    const ids = entries.slice(0, 3).map((e) => e.memberId);
    if (ids.length === 0) return;
    supabaseClient
      .from('members')
      .select('id, img')
      .in('id', ids)
      .then(({ data }) => {
        images = Object.fromEntries(
          ((data ?? []) as { id: number; img: string | null }[]).map((m) => [m.id, m.img])
        );
      });
  });

  const medals = ['🥇', '🥈', '🥉'];
  // Second place left, winner in the middle, third right
  const podiumOrder = [1, 0, 2];
</script>

<div class="rounded-container border border-surface-200-800 p-3 flex flex-col min-w-0">
  <a
    {href}
    class="flex items-center justify-between gap-2 -mx-1 px-1 rounded hover:bg-surface-100-900"
    title={$_('page.stats.showAll', { values: { count: entries.length } })}
  >
    <h3 class="text-sm! font-semibold text-surface-600-400 mb-0! truncate">{section}</h3>
    <Fa icon={faAngleRight} class="text-surface-600-400" />
  </a>

  <div class="grid grid-cols-3 gap-2 items-end mt-3">
    {#each podiumOrder as place (place)}
      {@const e = entries[place]}
      <div class="text-center min-w-0">
        {#if e}
          <a href="/dashboard/members/{e.memberId}" class="group block">
            <div class="relative inline-block">
              {#if images[e.memberId]}
                <img
                  src={images[e.memberId]}
                  alt="{e.firstname} {e.lastname}"
                  class="rounded-full object-cover {place === 0 ? 'size-16' : 'size-12'}"
                  class:ring-2={place === 0}
                  class:ring-primary-500={place === 0}
                />
              {:else}
                <div
                  class="rounded-full bg-surface-200-800 flex items-center justify-center font-bold {place ===
                  0
                    ? 'size-16 text-lg ring-2 ring-primary-500'
                    : 'size-12 text-sm'}"
                >
                  {e.firstname.charAt(0)}{e.lastname.charAt(0)}
                </div>
              {/if}
              <span class="absolute -bottom-1 -right-1 text-lg leading-none" aria-hidden="true"
                >{medals[place]}</span
              >
            </div>
            <p class="mt-1 text-xs leading-tight truncate group-hover:underline">
              {e.firstname}<br />{e.lastname}
            </p>
            <p class="text-sm font-bold tabular-nums">{e.count}</p>
          </a>
        {/if}
      </div>
    {/each}
  </div>

  {#if entries.length > 3}
    <ol class="mt-3 pt-2 border-t border-surface-200-800 text-sm">
      {#each entries.slice(3, 10) as e (e.memberId)}
        <li>
          <a
            href="/dashboard/members/{e.memberId}"
            class="flex items-center gap-2 px-1 py-1 rounded hover:bg-surface-100-900"
          >
            <span class="w-5 text-right text-surface-600-400 tabular-nums">{e.rank}</span>
            <span class="flex-1 min-w-0 truncate">{e.firstname} {e.lastname}</span>
            <span class="tabular-nums text-surface-600-400">{e.count}</span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</div>
