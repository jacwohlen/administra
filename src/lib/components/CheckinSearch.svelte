<script lang="ts">
  /**
   * The one field above a check-in list (trainings and events). It searches
   * the list, which the page renders as `children` under it; from two letters
   * on it also offers the club's members who are not on the list yet, and
   * "Neu erstellen" for someone not in the app (a new member, label "new").
   *
   * Enter acts on the first match of the list (`onenter`, the page decides
   * what that means); when the list has none, or after the arrow keys picked
   * someone to add, it adds that person. Escape empties the field.
   */
  import type { Snippet } from 'svelte';
  import { modalDialog } from '#lib/modalDialog.ts';
  import type { Member } from '#lib/models.ts';
  import Fa from 'svelte-fa';
  import { faMagnifyingGlass, faUserPlus } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '#lib/supabase.ts';
  import { _ } from 'svelte-i18n';
  import { toaster } from '#lib/toast.ts';
  import { addCandidates, newMemberName, searchesToAdd, searchWords } from '#lib/checkinSearch.ts';
  import NewMemberForm from './NewMemberForm.svelte';

  let {
    value = $bindable(''),
    listed,
    canAdd = false,
    hint,
    oninput,
    onenter,
    onadd,
    onfocuschange,
    children
  }: {
    /** The search term; the page filters its list with it */
    value?: string;
    /** Ids of the people on the list, never offered to add */
    listed: Iterable<string | number>;
    /** Whether the field may add people (writers, an event still open) */
    canAdd?: boolean;
    /** A line under the people to add (e.g. that they count as attended) */
    hint?: string;
    /** After the term changed (typing, Escape, after adding) */
    oninput?: () => void;
    /** Enter on the list's first match; true when the page did something */
    onenter?: () => boolean;
    onadd?: (data: { member: Member }) => void;
    /** The page stops animating its list while someone types */
    onfocuschange?: (focused: boolean) => void;
    children?: Snippet;
  } = $props();

  let found: Member[] = $state([]);
  let searched = $state('');
  let selectedIndex = $state(-1);
  let saving = $state(false);
  let showNewMemberForm = $state(false);
  let newMember = $state({ lastname: '', firstname: '' });

  let adding = $derived(canAdd && searchesToAdd(value));
  let candidates = $derived(adding ? addCandidates(found, listed, value) : []);
  // Until the answer for the current term is in, the "not found" line waits
  let searchDone = $derived(searched === value.trim());

  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function lookUp() {
    clearTimeout(timer);
    selectedIndex = -1;
    const term = value.trim();
    if (!canAdd || !searchesToAdd(term)) {
      found = [];
      searched = term;
      return;
    }
    const current = ++request;
    timer = setTimeout(async () => {
      let query = supabaseClient
        .from('view_search_members')
        .select('id, fullname, lastname, firstname');
      for (const word of searchWords(term)) query = query.ilike('fullname', `%${word}%`);
      const { data, error } = await query.limit(30).returns<Member[]>();
      // A slower answer to an earlier term must not replace a newer one
      if (current !== request) return;
      if (error) console.error('Member search failed:', error);
      found = data ?? [];
      searched = term;
    }, 150);
  }

  function changed() {
    lookUp();
    oninput?.();
  }

  function clear() {
    value = '';
    changed();
  }

  function add(member: Member) {
    onadd?.({ member });
    clear();
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        if (candidates.length === 0) return;
        event.preventDefault();
        selectedIndex = selectedIndex < candidates.length - 1 ? selectedIndex + 1 : 0;
        break;
      case 'ArrowUp':
        if (candidates.length === 0) return;
        event.preventDefault();
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : candidates.length - 1;
        break;
      case 'Enter': {
        if (!value.trim()) return;
        event.preventDefault();
        const picked = candidates[selectedIndex];
        if (picked) {
          add(picked);
        } else if (onenter?.()) {
          clear();
        } else if (candidates.length === 1) {
          // Nobody on the list, and exactly one person to add
          add(candidates[0]);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        clear();
        break;
    }
  }

  function createNewMember() {
    newMember = newMemberName(value);
    showNewMemberForm = true;
  }

  async function handleNewMemberSubmit(r: { lastname: string; firstname: string }) {
    saving = true;
    try {
      const { error, data } = await supabaseClient
        .from('members')
        .insert({ ...r, labels: ['new'] })
        .select()
        .single();
      if (error) {
        console.error(error);
        toaster.error({ title: $_('page.members.createError') });
        return;
      }
      add(data);
      showNewMemberForm = false;
    } finally {
      saving = false;
    }
  }
</script>

<div class="sticky top-0 z-30 bg-surface-50-950 pb-3 -mx-3 px-3 sm:-mx-4 sm:px-4 pt-1">
  <div class="input-group grid-cols-[auto_1fr]">
    <div class="ig-cell">
      <Fa icon={canAdd ? faUserPlus : faMagnifyingGlass} />
    </div>
    <input
      class="input"
      type="search"
      enterkeyhint="go"
      autocomplete="off"
      placeholder={canAdd
        ? $_('components.CheckinSearch.placeholder')
        : $_('page.trainings.searchMembersPlaceholder')}
      aria-label={canAdd
        ? $_('components.CheckinSearch.placeholder')
        : $_('page.trainings.searchMembersPlaceholder')}
      bind:value
      oninput={changed}
      onkeydown={handleKeydown}
      onfocus={() => onfocuschange?.(true)}
      onblur={() => onfocuschange?.(false)}
      disabled={saving}
    />
  </div>
</div>

{@render children?.()}

{#if adding}
  <!-- Whoever is not on the list yet: under the list's matches, so these
       stay in view -->
  <div class="mt-2 p-3 rounded-lg preset-tonal-tertiary" aria-live="polite">
    <div class="text-xs font-semibold mb-1">{$_('components.CheckinSearch.notOnList')}</div>
    {#if candidates.length > 0}
      <ul class="max-h-72 overflow-y-auto -mx-1">
        {#each candidates as p, index (p.id)}
          <li>
            <button
              class="flex w-full items-center gap-3 rounded px-2 py-1.5 min-h-[44px] text-left {index ===
              selectedIndex
                ? 'bg-primary-200-800'
                : 'hover:bg-surface-50-950/40'}"
              onclick={() => add(p)}
            >
              <span class="flex-1 min-w-0 truncate">{p.lastname} {p.firstname}</span>
              <span class="flex items-center gap-1.5 text-sm font-medium text-primary-700-300">
                <Fa icon={faUserPlus} />
                {$_('button.add')}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if searchDone}
      <p class="text-sm py-1">{$_('page.trainings.memberNotFound')}</p>
    {/if}
    <button class="btn btn-sm preset-tonal-primary w-full mt-2" onclick={createNewMember}>
      <Fa icon={faUserPlus} />
      <span class="truncate">{$_('button.createNew')}: "{value.trim()}"</span>
    </button>
    {#if hint}
      <p class="text-xs mt-2">{hint}</p>
    {/if}
  </div>
{/if}

{#if showNewMemberForm}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (showNewMemberForm = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') showNewMemberForm = false;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      use:modalDialog
      class="card modal-dialog modal-dialog-lg"
      onclick={(e) => e.stopPropagation()}
    >
      <h3>{$_('button.createNew')}</h3>
      <NewMemberForm
        lastname={newMember.lastname}
        firstname={newMember.firstname}
        onclose={() => (showNewMemberForm = false)}
        onsubmit={handleNewMemberSubmit}
      />
    </div>
  </div>
{/if}
