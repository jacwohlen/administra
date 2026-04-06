<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import { faDownload, faGripLines } from '@fortawesome/free-solid-svg-icons';
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

<span class="flex justify-between items-center mb-4">
  <h1>
    {#if data.category?.toLowerCase() == 'athletes'}
      {$_('page.stats.topAthletes')}
    {:else if data.category?.toLowerCase() == 'events'}
      {$_('page.stats.topEventParticipants')}
    {:else if data.category?.toLowerCase() == 'coaches'}
      {$_('page.stats.topEventCoaches')}
    {:else}
      {$_('page.stats.topTrainers')}
    {/if}
    {data.section}
  </h1>
  <button type="button" class="btn btn-icon preset-tonal-surface" onclick={downloadCsv}
    ><Fa icon={faDownload} /></button
  >
</span>
<div class="mb-4">
  <input
    class="input"
    bind:value={searchTerm}
    type="text"
    placeholder={$_('page.trainings.searchMembersPlaceholder')}
  />
</div>

<ul class="flex flex-col gap-3">
  {#each data.athletes as e (e.memberId)}
    {#if search(e.firstname, e.lastname)}
      <li class="card p-4 flex items-center gap-3">
        <span>
          {e.rank.toString()}.
        </span>
        <span class="flex-auto font-bold">
          {e.lastname}
          {e.firstname}
          ({e.count})
        </span>
        <span>
          <a class="btn btn-sm preset-tonal-primary" href={'/dashboard/members/' + e.memberId}>
            <Fa icon={faGripLines} />
            <span class="hidden sm:inline">{$_('button.view')}</span>
          </a>
        </span>
      </li>
    {/if}
  {/each}
</ul>
