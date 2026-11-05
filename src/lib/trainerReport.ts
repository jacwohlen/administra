import type { TrainerTrackingRecord } from './models.ts';
import type { XlsxCell, XlsxSheet } from './xlsx.ts';

/** Per trainer: how often main trainer, how often assistant */
export interface TrainerSummaryRow {
  memberId: number;
  name: string;
  mainTrainerCount: number;
  assistantCount: number;
  totalCount: number;
}

/** One training held on one date, with its trainers */
export interface TrainingLogRow {
  date: string;
  trainingId: number;
  trainingTitle: string;
  section: string;
  mainTrainers: string[];
  assistants: string[];
  attendeeCount: number;
}

export interface TrainerReportLabels {
  sheetName: string;
  title: string;
  summary: string;
  log: string;
  trainer: string;
  mainTrainer: string;
  assistant: string;
  total: string;
  date: string;
  training: string;
  section: string;
  mainTrainers: string;
  assistants: string;
  attendees: string;
}

const personName = (r: TrainerTrackingRecord) => `${r.lastname} ${r.firstname}`.trim();

export function trainerSummary(records: TrainerTrackingRecord[]): TrainerSummaryRow[] {
  const byMember = new Map<number, TrainerSummaryRow>();
  for (const r of records) {
    let row = byMember.get(r.memberId);
    if (!row) {
      row = {
        memberId: r.memberId,
        name: personName(r),
        mainTrainerCount: 0,
        assistantCount: 0,
        totalCount: 0
      };
      byMember.set(r.memberId, row);
    }
    if (r.trainerRole === 'main_trainer') row.mainTrainerCount++;
    else if (r.trainerRole === 'assistant') row.assistantCount++;
    else continue;
    row.totalCount++;
  }
  return [...byMember.values()]
    .filter((row) => row.totalCount > 0)
    .sort(
      (a, b) =>
        b.totalCount - a.totalCount ||
        b.mainTrainerCount - a.mainTrainerCount ||
        a.name.localeCompare(b.name, 'de')
    );
}

/** Every training held, oldest first */
export function trainingLog(records: TrainerTrackingRecord[]): TrainingLogRow[] {
  const sessions = new Map<string, TrainingLogRow>();
  for (const r of records) {
    const key = `${r.date}|${r.trainingId}`;
    let row = sessions.get(key);
    if (!row) {
      row = {
        date: r.date,
        trainingId: r.trainingId,
        trainingTitle: r.trainingTitle,
        section: r.section,
        mainTrainers: [],
        assistants: [],
        attendeeCount: Number(r.attendeeCount) || 0
      };
      sessions.set(key, row);
    }
    const list =
      r.trainerRole === 'main_trainer'
        ? row.mainTrainers
        : r.trainerRole === 'assistant'
          ? row.assistants
          : undefined;
    const name = personName(r);
    if (list && !list.includes(name)) list.push(name);
  }
  const rows = [...sessions.values()];
  for (const row of rows) {
    row.mainTrainers.sort((a, b) => a.localeCompare(b, 'de'));
    row.assistants.sort((a, b) => a.localeCompare(b, 'de'));
  }
  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.section.localeCompare(b.section, 'de') ||
      a.trainingTitle.localeCompare(b.trainingTitle, 'de') ||
      a.trainingId - b.trainingId
  );
}

/** dd.mm.yyyy for a yyyy-mm-dd date */
function swissDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date;
}

/**
 * The trainer report as one worksheet: the summary per trainer on top,
 * then the log of every training with its trainers and attendee count.
 */
export function trainerReportSheet(
  records: TrainerTrackingRecord[],
  labels: TrainerReportLabels,
  period: string
): XlsxSheet {
  const rows: XlsxCell[][] = [];
  const boldRows: number[] = [];
  const bold = (row: XlsxCell[]) => {
    boldRows.push(rows.length);
    rows.push(row);
  };

  bold([`${labels.title} ${period}`.trim()]);
  rows.push([]);

  bold([labels.summary]);
  bold([labels.trainer, labels.mainTrainer, labels.assistant, labels.total]);
  const summary = trainerSummary(records);
  for (const s of summary) rows.push([s.name, s.mainTrainerCount, s.assistantCount, s.totalCount]);
  bold([
    labels.total,
    summary.reduce((n, s) => n + s.mainTrainerCount, 0),
    summary.reduce((n, s) => n + s.assistantCount, 0),
    summary.reduce((n, s) => n + s.totalCount, 0)
  ]);
  rows.push([]);

  bold([labels.log]);
  bold([
    labels.date,
    labels.training,
    labels.section,
    labels.mainTrainers,
    labels.assistants,
    labels.attendees
  ]);
  for (const t of trainingLog(records)) {
    rows.push([
      swissDate(t.date),
      t.trainingTitle,
      t.section,
      t.mainTrainers.join(', '),
      t.assistants.join(', '),
      t.attendeeCount
    ]);
  }

  return { name: labels.sheetName, rows, boldRows, columnWidths: [28, 28, 16, 30, 40, 14] };
}
