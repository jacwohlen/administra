<script lang="ts" module>
  export interface ListedMember {
    memberId: number;
    firstname: string;
    lastname: string;
    sub: string;
    date: string;
  }
</script>

<script lang="ts">
  import { _ } from 'svelte-i18n';

  /** Names behind the figures, linked to the member profile. */
  let {
    title,
    members,
    limit = 10
  }: { title: string; members: ListedMember[]; limit?: number } = $props();

  let expanded = $state(false);
</script>

<div class="min-w-0">
  <h3 class="text-sm! font-semibold text-surface-600-400 mb-1!">{title}</h3>
  <ol class="divide-y divide-surface-200-800">
    {#each expanded ? members : members.slice(0, limit) as m (m.memberId)}
      <li>
        <a
          href="/dashboard/members/{m.memberId}"
          class="list-item px-2 -mx-2 rounded hover:bg-surface-100-900"
        >
          <span class="avatar-initials">{m.firstname.charAt(0)}{m.lastname.charAt(0)}</span>
          <span class="list-item-content">
            <span class="block truncate">{m.firstname} {m.lastname}</span>
            <span class="block truncate text-xs text-surface-600-400">{m.sub}</span>
          </span>
          <span class="text-xs text-surface-600-400 tabular-nums flex-none">{m.date}</span>
        </a>
      </li>
    {/each}
  </ol>
  {#if members.length > limit}
    <button
      class="btn btn-sm preset-tonal-surface w-full mt-2"
      onclick={() => (expanded = !expanded)}
    >
      {expanded
        ? $_('page.stats.showLess')
        : $_('page.stats.showAll', { values: { count: members.length } })}
    </button>
  {/if}
</div>
