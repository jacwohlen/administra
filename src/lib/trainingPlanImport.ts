import dayjs from 'dayjs';
import type { PlanTraining } from './trainingPlanUtils';

/**
 * Import of the TK's Google Sheet ("Trainingsplanung": one row per day with
 * KW, Tag, Datum, Trainingstyp, Von, Bis, Leiter, Thema, Info / Bemerkung),
 * pasted from the sheet (tab separated) or downloaded as CSV.
 */

/** One day of the sheet */
export interface SheetRow {
  date: string;
  type: string;
  leader: string;
  topic: string;
  info: string;
}

export interface ImportSession {
  training_id: number;
  date: string;
  trainer_id: number | null;
  topic: string | null;
  notes: string | null;
  cancelled: boolean | null;
}

export interface ImportBreak {
  title: string;
  date_from: string;
  date_to: string;
  cancels_training: boolean;
}

export interface ImportResult {
  sessions: ImportSession[];
  breaks: ImportBreak[];
  /** Rows with a training on a weekday without a planned training (e.g. Thursday) */
  skipped: number;
}

export interface ImportMember {
  id: number;
  firstname: string;
  lastname: string;
}

/** Splits CSV / TSV text into rows of cells; quoted cells may hold separators and line breaks */
export function splitTable(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.includes('\t')
    ? '\t'
    : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 2026-01-05, 05.01.2026, 5.1.26, "Mo, 05.01.2026" → 2026-01-05 */
export function parseSheetDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return normalized(+m[1], +m[2], +m[3]);
  m = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return normalized(year, +m[2], +m[1]);
  }
  return null;
}

function normalized(y: number, m: number, d: number): string | null {
  const date = dayjs(new Date(y, m - 1, d));
  return date.isValid() && date.date() === d && date.month() === m - 1
    ? date.format('YYYY-MM-DD')
    : null;
}

/** "-" and "–" mean empty in the sheet */
function clean(v: string | undefined): string {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t === '-' || t === '–' ? '' : t;
}

/** The rows of the sheet, found by the header row (column order does not matter) */
export function parseSheet(text: string): SheetRow[] | null {
  const table = splitTable(text);
  const headerIndex = table.findIndex((r) => r.some((c) => c.trim().toLowerCase() === 'datum'));
  if (headerIndex < 0) return null;
  const header = table[headerIndex].map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  const cols = {
    date: header.indexOf('datum'),
    type: col('trainingstyp', 'typ'),
    leader: col('leiter', 'trainer'),
    topic: col('thema'),
    info: col('info', 'bemerkung')
  };
  const rows: SheetRow[] = [];
  for (const r of table.slice(headerIndex + 1)) {
    const date = parseSheetDate(r[cols.date] ?? '');
    if (!date) continue;
    rows.push({
      date,
      type: cols.type < 0 ? '' : clean(r[cols.type]),
      leader: cols.leader < 0 ? '' : clean(r[cols.leader]),
      topic: cols.topic < 0 ? '' : clean(r[cols.topic]),
      info: cols.info < 0 ? '' : clean(r[cols.info])
    });
  }
  return rows;
}

const CANCELLED = /kein training/i;
const HOLIDAY = /ferien|weihnacht/i;
/** Leiter entries that are not a person */
const NO_LEADER = /^(kein training)?$/i;

function infoParts(info: string): string[] {
  return info
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && p !== '-');
}

/** The leader names of the rows, for matching them to members */
export function sheetLeaders(rows: SheetRow[]): string[] {
  const names = new Set<string>();
  for (const r of rows) if (!NO_LEADER.test(r.leader)) names.add(r.leader);
  return [...names].sort((a, b) => a.localeCompare(b));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The member a leader name stands for: "Vorname Nachname" or the other way
 * round; else the only member with that last name whose first name starts
 * like the name in the sheet ("Beni" for Benjamin, "Roli" for Roland).
 */
export function matchLeader(name: string, members: ImportMember[]): number | null {
  const n = norm(name);
  const exact = members.find(
    (m) => norm(`${m.firstname} ${m.lastname}`) === n || norm(`${m.lastname} ${m.firstname}`) === n
  );
  if (exact) return exact.id;
  const parts = n.split(' ');
  if (parts.length < 2) return null;
  const first = parts[0].slice(0, 3);
  const last = parts.slice(1).join(' ');
  const close = members.filter(
    (m) => norm(m.lastname) === last && norm(m.firstname).startsWith(first)
  );
  return close.length === 1 ? close[0].id : null;
}

/** "kampf" for "Kampftraining": whether the type is just the training itself */
function typeKey(type: string): string {
  return norm(type)
    .replace(/training/g, '')
    .trim();
}

function pickTraining(type: string, candidates: PlanTraining[]): PlanTraining {
  const key = typeKey(type);
  return (key && candidates.find((t) => norm(t.title).includes(key))) || candidates[0];
}

/**
 * The sessions and holidays of the sheet for the planned trainings:
 * - a row with a training type plans the training of its weekday (by the
 *   type's name when there are several), with leader, topic and the info
 *   (holidays left out) as note; a type other than the training's own
 *   ("freies Training", "Heimkampf") becomes the topic
 * - "kein Training" and an empty type drop the training, the info says why
 * - holidays in the info ("Sportferien", "Weihnachten") become breaks; they
 *   close the dojo only when none of the planned trainings took place
 * Leaders without a member stay in the note.
 */
export function buildImport(
  rows: SheetRow[],
  trainings: PlanTraining[],
  leaderIds: Map<string, number | null>
): ImportResult {
  const byWeekday = new Map<number, PlanTraining[]>();
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const t of trainings) {
    const day = WEEKDAYS.indexOf(t.weekday);
    byWeekday.set(day, [...(byWeekday.get(day) ?? []), t]);
  }

  const sessions = new Map<string, ImportSession>();
  const holidayDates = new Map<string, string[]>();
  let skipped = 0;

  for (const r of rows) {
    const parts = infoParts(r.info);
    for (const p of parts.filter((p) => HOLIDAY.test(p))) {
      holidayDates.set(p, [...(holidayDates.get(p) ?? []), r.date]);
    }
    const candidates = byWeekday.get(dayjs(r.date).day()) ?? [];
    if (candidates.length === 0) {
      if (r.type) skipped++;
      continue;
    }

    const leaderId = NO_LEADER.test(r.leader) ? null : (leaderIds.get(r.leader) ?? null);
    const notes = [
      ...(r.leader && !NO_LEADER.test(r.leader) && leaderId == null ? [r.leader] : []),
      ...parts.filter((p) => !HOLIDAY.test(p))
    ].join(', ');
    const cancelled = !r.type || CANCELLED.test(r.type);

    // An empty type drops every training of the day, a typed row only one
    const targets = r.type ? [pickTraining(r.type, candidates)] : candidates;
    for (const t of targets) {
      const ownType = !r.type || CANCELLED.test(r.type) || norm(t.title).includes(typeKey(r.type));
      const topic = cancelled
        ? null
        : ownType
          ? r.topic || null
          : r.topic
            ? `${r.type}: ${r.topic}`
            : r.type;
      sessions.set(`${t.id}|${r.date}`, {
        training_id: t.id,
        date: r.date,
        trainer_id: cancelled ? null : leaderId,
        topic,
        notes: notes || null,
        cancelled: cancelled ? true : null
      });
    }
  }

  const breaks: ImportBreak[] = [];
  for (const [title, dates] of holidayDates) {
    dates.sort();
    let start = 0;
    for (let i = 1; i <= dates.length; i++) {
      if (i < dates.length && dayjs(dates[i]).diff(dates[i - 1], 'day') <= 2) continue;
      const from = dates[start];
      const to = dates[i - 1];
      const inside = [...sessions.values()].filter((s) => s.date >= from && s.date <= to);
      breaks.push({
        title,
        date_from: from,
        date_to: to,
        cancels_training: inside.length > 0 && inside.every((s) => s.cancelled)
      });
      start = i;
    }
  }
  breaks.sort((a, b) => a.date_from.localeCompare(b.date_from));

  return {
    sessions: [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date)),
    breaks,
    skipped
  };
}
