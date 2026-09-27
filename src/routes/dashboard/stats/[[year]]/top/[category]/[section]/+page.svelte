<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faArrowLeft, faDownload } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import type { Athletes } from '$lib/models';

  let { data }: { data: PageData } = $props();
  let searchTerm = $state('');

  let search = $derived((firstname: string, lastname: string): boolean => {
    let q = searchTerm.toLowerCase().trim();
    let firstlast = firstname.toLowerCase() + ' ' + lastname.toLowerCase();
    let lastfirst = lastname.toLowerCase() + ' ' + firstname.toLowerCase();
    return firstlast.startsWith(q) || lastfirst.startsWith(q);
  });

  // Convert data to CSV format
  function convertToCSV(data: Athletes[]) {
    const headers = Object.keys(data[0]).join(',') + '\n'; // Get the keys for headers
    const rows = data.map((row) => Object.values(row).join(',')).join('\n'); // Get the rows
    return headers + rows;
  }

  // Download the CSV file
  function downloadCsv() {
    const csvData = convertToCSV(data.athletes);
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');

    const filename = data.category + '_' + data.section + '_' + data.year + '.csv';
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    a.click();

    window.URL.revokeObjectURL(url); // Clean up the URL object after download
  }
</script>

<div class="space-y-4">
  <div class="page-header-back mb-0!">
    <a
      href="/dashboard/stats/{data.year ?? ''}"
      class="btn preset-tonal-surface flex-shrink-0"
      aria-label={$_('page.dashboard.stats')}
    >
      <Fa icon={faArrowLeft} />
    </a>
    <div class="flex-1 min-w-0">
      <h1 class="truncate mb-0!">
        {#if data.category?.toLowerCase() == 'athletes'}
          {$_('page.stats.topAthletes')}
        {:else if data.category?.toLowerCase() == 'events'}
          {$_('page.stats.topEventParticipants')}
        {:else if data.category?.toLowerCase() == 'coaches'}
          {$_('page.stats.topEventCoaches')}
        {:else}
          {$_('page.stats.topTrainers')}
        {/if}
      </h1>
      <p class="text-sm text-surface-600-400 truncate">
        {data.section} &middot; {data.year === 'ALL' || !data.year
          ? $_('page.stats.all')
          : data.year}
      </p>
    </div>
    <button
      type="button"
      class="btn preset-tonal-surface flex-shrink-0"
      onclick={downloadCsv}
      title={$_('button.download')}
      aria-label={$_('button.download')}
    >
      <Fa icon={faDownload} />
    </button>
  </div>

  <input
    class="input"
    bind:value={searchTerm}
    type="search"
    placeholder={$_('page.trainings.searchMembersPlaceholder')}
  />

  <section class="card border border-surface-200-800 px-2 py-1">
    <ol class="divide-y divide-surface-200-800">
      {#each data.athletes as e (e.memberId)}
        {#if search(e.firstname, e.lastname)}
          <li>
            <a
              href="/dashboard/members/{e.memberId}"
              class="list-item px-2 rounded hover:bg-surface-100-900"
            >
              <span class="w-8 text-right font-semibold tabular-nums text-surface-600-400">
                {#if e.rank <= 3}{['🥇', '🥈', '🥉'][e.rank - 1]}{:else}{e.rank}{/if}
              </span>
              <span class="avatar-initials">{e.firstname.charAt(0)}{e.lastname.charAt(0)}</span>
              <span class="list-item-content truncate">{e.firstname} {e.lastname}</span>
              <span class="chip preset-tonal-surface tabular-nums">{e.count}</span>
            </a>
          </li>
        {/if}
      {/each}
    </ol>
  </section>
</div>
