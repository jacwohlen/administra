<script lang="ts">
  import { buildXlsx, XLSX_MIME } from '#lib/xlsx.ts';
  import { trainerReportSheet, type TrainerReportLabels } from '#lib/trainerReport.ts';
  import { rpcRows } from '#lib/supabase.ts';
  import type { TrainerTrackingRecord } from '#lib/models.ts';
  import Fa from 'svelte-fa';
  import { faDownload, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import { toaster } from '#lib/toast.ts';

  let { year, yearmode }: { year: number | string; yearmode: 'YEAR' | 'ALL' } = $props();

  let isDownloading = $state(false);

  async function downloadTrainerTracking() {
    isDownloading = true;
    try {
      const yearParam = yearmode === 'ALL' ? '' : year.toString();

      const { error, data } = await rpcRows<TrainerTrackingRecord>('get_trainer_tracking_data', {
        year_param: yearParam
      });

      if (error) {
        console.error('Error fetching trainer data:', error);
        toaster.error({ title: $_('page.stats.downloadError') });
        return;
      }

      if (!data || data.length === 0) {
        toaster.info({ title: $_('page.stats.noTrainerData') });
        return;
      }

      const period = yearmode === 'ALL' ? $_('page.stats.all') : String(year);
      const sheet = trainerReportSheet(data, reportLabels(), period);
      const blob = new Blob([buildXlsx(sheet)], { type: XLSX_MIME });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', `trainer_tracking_${yearmode === 'ALL' ? 'all' : year}.xlsx`);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      toaster.error({ title: $_('page.stats.downloadError') });
    } finally {
      isDownloading = false;
    }
  }

  function reportLabels(): TrainerReportLabels {
    const t = (key: string) => $_(`page.stats.trainerReport.${key}`);
    return {
      sheetName: t('sheetName'),
      title: t('title'),
      summary: t('summary'),
      log: t('log'),
      trainer: t('trainer'),
      mainTrainer: t('mainTrainer'),
      assistant: t('assistant'),
      total: t('total'),
      date: t('date'),
      training: t('training'),
      section: t('section'),
      mainTrainers: t('mainTrainers'),
      assistants: t('assistants'),
      attendees: t('attendees')
    };
  }
</script>

<button
  class="btn btn-sm preset-tonal-surface"
  onclick={downloadTrainerTracking}
  disabled={isDownloading}
  title={$_('page.stats.downloadTrainerTracking')}
>
  <Fa icon={isDownloading ? faSpinner : faDownload} spin={isDownloading} />
  <span class="hidden sm:inline">{$_('page.stats.downloadTrainerTracking')}</span>
</button>
