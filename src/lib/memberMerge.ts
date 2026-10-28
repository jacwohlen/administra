import dayjs, { type Dayjs } from 'dayjs';
import type { DuplicateCandidate } from './memberDuplicates';
import type { MemberMergeResult, MergeAccount, MergeConflict, MergeCount } from './models';

/**
 * Merging a duplicate member (merge_members / merge_members_preview in
 * 20261028110000_merge_duplicate_members.sql): how the dialog reads the
 * result, and the photo, which lives in Storage where SQL cannot move it.
 */

/** A member as the merge dialog and the duplicates list need it (MERGE_COLUMNS) */
export interface MergeMember extends DuplicateCandidate {
  mobile?: string | null;
}

/** members columns the merge dialog and the duplicates list load (no photo data) */
export const MERGE_COLUMNS =
  'id, firstname, lastname, birthday, mobile, email, labels, membership_status, archivedAt, trialRegisteredAt';

/** Avatar file of a member: named after its id and upload time (ms) */
export function avatarPath(memberId: number | string, imgUploaded: string | Dayjs): string {
  return `${memberId}_${dayjs(imgUploaded).valueOf()}.webp`;
}

/**
 * The references in the order the preview lists them, with their key under
 * page.members.merge.refs. merge_member_references() in SQL is the full list;
 * a reference added there later shows up under 'other'.
 */
export const MERGE_REFS: readonly (readonly [ref: string, key: string])[] = [
  ['logs.memberId', 'attendance'],
  ['participants.memberId', 'trainings'],
  ['event_participants.memberId', 'eventRegistrations'],
  ['event_logs.memberId', 'eventAttendance'],
  ['member_grades.memberId', 'grades'],
  ['member_medals.memberId', 'medals'],
  ['member_badges.memberId', 'badges'],
  ['exam_candidates.member_id', 'exams'],
  ['trial_emails.member_id', 'trialEmails'],
  ['training_plan_sessions.trainer_id', 'planSessions'],
  ['trainings.mainTrainerId', 'mainTrainer'],
  ['user_profiles.member_id', 'account'],
  ['member_links.member_id', 'links'],
  ['member_merges.kept_id', 'earlierMerges']
];

export interface MergeSummaryRow extends Required<MergeCount> {
  ref: string;
  /** i18n key under page.members.merge.refs, 'other' for an unknown reference */
  key: string;
}

/** What moves, per reference: only the ones with something to do */
export function mergeSummary(result: Pick<MemberMergeResult, 'moved'>): MergeSummaryRow[] {
  const known = new Map(MERGE_REFS);
  const order = (ref: string) => {
    const i = MERGE_REFS.findIndex(([r]) => r === ref);
    return i === -1 ? MERGE_REFS.length : i;
  };
  return Object.entries(result.moved ?? {})
    .map(([ref, count]) => ({
      ref,
      key: known.get(ref) ?? 'other',
      moved: count?.moved ?? 0,
      merged: count?.merged ?? 0,
      removed: count?.removed ?? 0
    }))
    .filter((row) => row.moved + row.merged + row.removed > 0)
    .sort((a, b) => order(a.ref) - order(b.ref) || a.ref.localeCompare(b.ref));
}

export const MERGE_ERROR_CODES = [
  'NOT_ALLOWED',
  'SAME_MEMBER',
  'MEMBER_NOT_FOUND',
  'BOTH_IN_PROVIDER',
  'KEEP_PROVIDER_ROW',
  'ACCOUNT_CONFLICT',
  'EXAM_CONFLICT',
  'UNHANDLED_REFERENCE'
] as const;

export type MergeErrorCode = (typeof MERGE_ERROR_CODES)[number] | 'unknown';

/** The refusal in an RPC error: its message starts with the code ('EXAM_CONFLICT', 'MEMBER_NOT_FOUND: 12') */
export function mergeErrorCode(error: unknown): MergeErrorCode {
  const message = (error as { message?: string } | null)?.message ?? '';
  const code = message.split(':')[0].trim();
  return (MERGE_ERROR_CODES as readonly string[]).includes(code)
    ? (code as MergeErrorCode)
    : 'unknown';
}

export interface MergeWarning {
  code: string;
  accounts?: number;
}

/** Warnings come as a code, or an object with details */
export function mergeWarnings(result: Pick<MemberMergeResult, 'warnings'>): MergeWarning[] {
  return (result.warnings ?? []).map((w) => (typeof w === 'string' ? { code: w } : w));
}

/** svelte-i18n's $_ as far as these helpers need it */
export type Translate = (
  key: string,
  options?: { values?: Record<string, string | number> }
) => string;

/**
 * One line per row both members had (page.members.merge.conflict.*): which
 * grade, medal or exam day, and which row stayed
 */
export function conflictText(conflict: MergeConflict, t: Translate): string {
  const key = (name: string) => `page.members.merge.conflict.${name}`;
  switch (conflict.ref) {
    case 'member_grades.memberId':
      return t(key(conflict.reason === 'exam' ? 'gradeExam' : 'gradeKeep'), {
        values: { grade: conflict.grade, section: conflict.section }
      });
    case 'member_medals.memberId':
      return conflict.keptMedal === conflict.droppedMedal
        ? t(key('medalSame'), {
            values: { competition: conflict.competition, medal: t(`medals.${conflict.keptMedal}`) }
          })
        : t(key('medal'), {
            values: {
              competition: conflict.competition,
              kept: t(`medals.${conflict.keptMedal}`),
              dropped: t(`medals.${conflict.droppedMedal}`)
            }
          });
    case 'exam_candidates.member_id':
      return t(key(conflict.reason === 'sheet' ? 'examSheet' : 'examStatus'), {
        values: { title: conflict.title, date: dayjs(conflict.date).format('DD.MM.YYYY') }
      });
    default:
      // A rule added in SQL later: still one line, by its reference
      return t(key('other'), { values: { ref: (conflict as { ref: string }).ref } });
  }
}

export type AccountChange = 'losesAccess' | 'gainsAccess' | 'losesRecord';

/**
 * Accounts the merge changes something for: one losing or gaining access
 * (only member accounts can; staff get in by their role), or one that no
 * longer finds the person (e.g. a trainer's "Mein Profil" by e-mail)
 */
export function accountChanges(
  result: Pick<MemberMergeResult, 'accounts'>
): { account: MergeAccount; change: AccountChange }[] {
  return (result.accounts ?? []).flatMap((account) => {
    const change: AccountChange | null =
      account.before && !account.after
        ? 'losesAccess'
        : !account.before && account.after
          ? 'gainsAccess'
          : account.findsBefore && !account.findsAfter
            ? 'losesRecord'
            : null;
    return change ? [{ account, change }] : [];
  });
}

/** The calls the photo needs; supabaseClient.storage.from('avatars') has them */
export interface AvatarStorage {
  copy(fromPath: string, toPath: string): PromiseLike<{ error: unknown }>;
  remove(paths: string[]): PromiseLike<{ error: unknown }>;
}

/**
 * Runs the merge and keeps the photo files in step with it. The database
 * names the dropped member's file (fields.dropPhotoUploaded): a member row
 * the page loaded earlier can be older than the database. When the kept
 * member takes over the photo (the preview's fields.photo), the file is
 * copied to the kept member's name first: if that fails (an old member with
 * only the thumbnail), the member page falls back to the thumbnail. After a
 * failed merge the copy goes again; after a merge the dropped member's file
 * goes, and a copy the merge did not use. Removing is best effort: a
 * leftover file is harmless.
 */
export async function mergeWithPhoto(
  storage: AvatarStorage,
  preview: Pick<MemberMergeResult, 'fields'>,
  keepId: number,
  dropId: number,
  merge: () => Promise<MemberMergeResult>
): Promise<MemberMergeResult> {
  const uploaded = preview.fields?.dropPhotoUploaded ?? null;
  const dropFile = uploaded ? avatarPath(dropId, uploaded) : null;
  let copied: string | null = null;
  if (preview.fields?.photo === 'from_drop' && dropFile && uploaded) {
    const target = avatarPath(keepId, uploaded);
    const { error } = await storage.copy(dropFile, target);
    if (!error) copied = target;
  }

  const removeQuietly = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const { error } = await storage.remove(paths);
      if (error) console.error('Error removing profile pictures:', error);
    } catch (e) {
      console.error('Error removing profile pictures:', e);
    }
  };

  let result: MemberMergeResult;
  try {
    result = await merge();
  } catch (e) {
    if (copied) await removeQuietly([copied]);
    throw e;
  }
  // The merge read the rows again: what it wrote decides which file is used
  const done = result.fields?.dropPhotoUploaded ?? null;
  const used = result.fields?.photo === 'from_drop' && done ? avatarPath(keepId, done) : null;
  const stale = new Set<string>();
  if (dropFile) stale.add(dropFile);
  if (done) stale.add(avatarPath(dropId, done));
  if (copied && copied !== used) stale.add(copied);
  await removeQuietly([...stale]);
  return result;
}
