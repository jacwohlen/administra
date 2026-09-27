import type { Training, TrainerRole } from '$lib/models';
import utils from '$lib/utils';

interface ChecklistMemberData {
  memberId: string;
  firstname: string;
  lastname: string;
  labels: string[];
  img: string;
  date: string | null;
  trainerRole: TrainerRole;
}

interface StreakRow {
  memberId: number;
  date: string;
  seq: number;
}

export interface MemberWithStreak {
  id: string;
  firstname: string;
  lastname: string;
  labels: string[];
  img: string;
  isPresent: boolean;
  trainerRole: TrainerRole;
  streak: boolean[];
}

/**
 * Builds a map of memberId -> Set of sequence numbers they attended,
 * and returns the total number of distinct dates.
 */
export function buildStreakMap(streakRows: StreakRow[]): {
  memberSeqs: Map<number, Set<number>>;
  totalDates: number;
} {
  const totalDates = new Set(streakRows.map((r) => r.seq)).size;
  const memberSeqs = new Map<number, Set<number>>();

  for (const row of streakRows) {
    if (!memberSeqs.has(row.memberId)) {
      memberSeqs.set(row.memberId, new Set());
    }
    memberSeqs.get(row.memberId)!.add(row.seq);
  }

  return { memberSeqs, totalDates };
}

/**
 * Transforms raw checklist + streak data into MemberWithStreak objects.
 */
export function buildMembersWithStreaks(
  checklistData: ChecklistMemberData[],
  streakRows: StreakRow[]
): MemberWithStreak[] {
  const { memberSeqs, totalDates } = buildStreakMap(streakRows);
  const seqNumbers = Array.from({ length: totalDates }, (_, i) => i + 1);

  return checklistData.map((item) => ({
    id: item.memberId,
    firstname: item.firstname,
    lastname: item.lastname,
    labels: item.labels,
    img: item.img,
    isPresent: item.date ? true : false,
    trainerRole: item.trainerRole || 'attendee',
    streak: seqNumbers.map((seq) => memberSeqs.get(Number(item.memberId))?.has(seq) ?? false)
  }));
}

/**
 * Minutes since midnight for a stored training time. Times are free text and
 * appear as "18:00" as well as "18.00"; unparsable values sort last.
 */
export function timeToMinutes(time: string | null | undefined): number {
  const match = /^\s*(\d{1,2})(?:[:.](\d{2}))?/.exec(time ?? '');
  if (!match) return Number.MAX_SAFE_INTEGER;
  return parseInt(match[1]) * 60 + parseInt(match[2] ?? '0');
}

/**
 * Normalises a stored training time for display, e.g. "18.00" -> "18:00".
 */
export function formatTime(time: string | null | undefined): string {
  const minutes = timeToMinutes(time);
  if (minutes === Number.MAX_SAFE_INTEGER) return time ?? '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Comparator for sorting trainings by weekday first, then by start time.
 */
export function compareTrainings(a: Training, b: Training): number {
  const result = utils.weekdayToNumber(a.weekday) - utils.weekdayToNumber(b.weekday);
  return result !== 0 ? result : timeToMinutes(a.dateFrom) - timeToMinutes(b.dateFrom);
}
