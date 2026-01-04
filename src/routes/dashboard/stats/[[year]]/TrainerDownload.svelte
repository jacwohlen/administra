<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import type { TrainerTrackingRecord, TrainerRole } from '$lib/models';
  import Fa from 'svelte-fa';
  import { faDownload, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';

  export let year: number | string;
  export let yearmode: 'YEAR' | 'ALL';

  let isDownloading = false;

  async function downloadTrainerTracking() {
    isDownloading = true;
    try {
      const yearParam = yearmode === 'ALL' ? '' : year.toString();

      const { error, data } = await supabaseClient
        .rpc('get_trainer_tracking_data', { year_param: yearParam })
        .returns<TrainerTrackingRecord[]>();

      if (error) {
        console.error('Error fetching trainer data:', error);
        alert($_('page.stats.downloadError'));
        return;
      }

      if (!data || data.length === 0) {
        alert($_('page.stats.noTrainerData'));
        return;
      }

      // Generate CSV
      const csv = generateTrainerCSV(data);

      // Download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');

      const filename = `trainer_tracking_${yearmode === 'ALL' ? 'all' : year}.csv`;
      a.setAttribute('href', url);
      a.setAttribute('download', filename);
      a.click();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert($_('page.stats.downloadError'));
    } finally {
      isDownloading = false;
    }
  }

  function generateTrainerCSV(data: TrainerTrackingRecord[]): string {
    // Headers
    const headers = [
      'Date',
      'Training',
      'Section',
      'Trainer Lastname',
      'Trainer Firstname',
      'Role',
      'Attendee Count'
    ];

    // Build CSV rows
    const rows = data.map((record) => [
      record.date,
      record.trainingTitle,
      record.section,
      record.lastname,
      record.firstname,
      getRoleLabel(record.trainerRole),
      record.attendeeCount.toString()
    ]);

    // Add summary section
    const summaryData = generateSummary(data);
    rows.push([]); // Empty row
    rows.push(['Summary Statistics']);
    rows.push(['Trainer', 'Main Trainer Sessions', 'Assistant Sessions', 'Total Sessions']);

    summaryData.forEach((summary) => {
      rows.push([
        `${summary.lastname} ${summary.firstname}`,
        summary.mainTrainerCount.toString(),
        summary.assistantCount.toString(),
        summary.totalCount.toString()
      ]);
    });

    // Convert to CSV string with proper escaping
    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => escapeCSVCell(cell)).join(','))
    ].join('\n');

    return csvContent;
  }

  function escapeCSVCell(cell: string): string {
    // If cell contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  }

  function getRoleLabel(role: TrainerRole): string {
    switch (role) {
      case 'main_trainer':
        return 'Main Trainer';
      case 'assistant':
        return 'Assistant';
      default:
        return 'Attendee';
    }
  }

  function generateSummary(data: TrainerTrackingRecord[]) {
    const trainerMap = new Map<
      number,
      {
        lastname: string;
        firstname: string;
        mainTrainerCount: number;
        assistantCount: number;
        totalCount: number;
      }
    >();

    data.forEach((record) => {
      if (!trainerMap.has(record.memberId)) {
        trainerMap.set(record.memberId, {
          lastname: record.lastname,
          firstname: record.firstname,
          mainTrainerCount: 0,
          assistantCount: 0,
          totalCount: 0
        });
      }

      const trainer = trainerMap.get(record.memberId)!;
      if (record.trainerRole === 'main_trainer') {
        trainer.mainTrainerCount++;
      } else if (record.trainerRole === 'assistant') {
        trainer.assistantCount++;
      }
      trainer.totalCount++;
    });

    return Array.from(trainerMap.values()).sort(
      (a, b) => b.totalCount - a.totalCount || a.lastname.localeCompare(b.lastname)
    );
  }
</script>

<div class="flex items-center gap-2">
  <button
    class="btn variant-filled-secondary"
    on:click={downloadTrainerTracking}
    disabled={isDownloading}
  >
    <Fa icon={isDownloading ? faSpinner : faDownload} spin={isDownloading} />
    <span>{$_('page.stats.downloadTrainerTracking')}</span>
  </button>
</div>
