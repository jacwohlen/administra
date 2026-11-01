import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import type { MemberMergeResult } from './models';
import {
  accountChanges,
  avatarPath,
  conflictText,
  MERGE_REFS,
  mergeErrorCode,
  mergeSummary,
  mergeWarnings,
  mergeWithPhoto,
  type AvatarStorage,
  type Translate
} from './memberMerge';

function result(overrides: Partial<MemberMergeResult> = {}): MemberMergeResult {
  return {
    keep: 4321,
    drop: 10_000_005,
    keepInProvider: true,
    status: { before: 'active', after: 'active' },
    moved: {},
    conflicts: [],
    fields: {
      birthday: 'same',
      mobile: 'same',
      email: 'same',
      notes: 'same',
      photo: 'none',
      dropPhotoUploaded: null,
      archived: 'not_archived',
      labelsNotCarried: [],
      trial: 'none',
      trialStatus: null
    },
    accounts: [],
    warnings: [],
    badges: { added: [], removed: [], othersChanged: 0 },
    ...overrides
  };
}

describe('avatarPath', () => {
  it('names the file after member id and upload time in ms, as the member page does', () => {
    expect(avatarPath(12, '2024-05-01T10:00:00.123Z')).toBe('12_1714557600123.webp');
    expect(avatarPath('12', dayjs('2024-05-01T10:00:00.123Z'))).toBe('12_1714557600123.webp');
  });
});

describe('mergeSummary', () => {
  it('lists references with something to do, in display order', () => {
    const rows = mergeSummary(
      result({
        moved: {
          'trial_emails.member_id': { moved: 2, merged: 0 },
          'logs.memberId': { moved: 12, merged: 1 },
          'trainings.mainTrainerId': { moved: 0, merged: 0 },
          'member_links.member_id': { moved: 0, merged: 0, removed: 1 }
        }
      })
    );
    expect(rows.map((r) => [r.key, r.moved, r.merged, r.removed])).toEqual([
      ['attendance', 12, 1, 0],
      ['trialEmails', 2, 0, 0],
      ['links', 0, 0, 1]
    ]);
  });

  it('shows a reference added later in SQL as other', () => {
    const rows = mergeSummary(
      result({ moved: { 'new_table.member_id': { moved: 1, merged: 0 } } })
    );
    expect(rows).toEqual([
      { ref: 'new_table.member_id', key: 'other', moved: 1, merged: 0, removed: 0 }
    ]);
  });

  it('knows every foreign key the migration lists', () => {
    expect(MERGE_REFS.map(([ref]) => ref).sort()).toEqual([
      'event_logs.memberId',
      'event_participants.memberId',
      'exam_candidates.member_id',
      'logs.memberId',
      'member_badges.memberId',
      'member_grades.memberId',
      'member_links.member_id',
      'member_medals.memberId',
      'member_merges.kept_id',
      'participants.memberId',
      'training_plan_mail_optouts.member_id',
      'training_plan_mails.member_id',
      'training_plan_sessions.trainer_id',
      'training_plan_told_trainings.member_id',
      'trainings.mainTrainerId',
      'trial_emails.member_id',
      'user_profiles.member_id'
    ]);
  });
});

describe('mergeErrorCode', () => {
  it('reads the code at the start of the message', () => {
    expect(mergeErrorCode({ message: 'EXAM_CONFLICT' })).toBe('EXAM_CONFLICT');
    expect(mergeErrorCode({ message: 'MEMBER_NOT_FOUND: 12' })).toBe('MEMBER_NOT_FOUND');
    expect(mergeErrorCode({ message: 'UNHANDLED_REFERENCE: x.member_id' })).toBe(
      'UNHANDLED_REFERENCE'
    );
    expect(mergeErrorCode({ message: 'NOT_ALLOWED' })).toBe('NOT_ALLOWED');
  });

  it('falls back to unknown', () => {
    expect(mergeErrorCode({ message: 'Failed to fetch' })).toBe('unknown');
    expect(mergeErrorCode(null)).toBe('unknown');
  });
});

describe('mergeWarnings', () => {
  it('turns plain codes into objects', () => {
    expect(
      mergeWarnings(
        result({ warnings: ['TRIAL_LINK_ENDS', { code: 'ACCOUNT_LOSES_ACCESS', accounts: 2 }] })
      )
    ).toEqual([{ code: 'TRIAL_LINK_ENDS' }, { code: 'ACCOUNT_LOSES_ACCESS', accounts: 2 }]);
  });
});

describe('conflictText', () => {
  // Echoes the key and its values, so the test sees what the dialog asks for
  const t: Translate = (key, options) =>
    options?.values ? `${key} ${JSON.stringify(options.values)}` : key;

  it('names the grade and why its row stayed', () => {
    expect(
      conflictText(
        {
          ref: 'member_grades.memberId',
          section: 'Judo',
          grade: '5. Kyu',
          kept: 'drop',
          reason: 'exam'
        },
        t
      )
    ).toBe('page.members.merge.conflict.gradeExam {"grade":"5. Kyu","section":"Judo"}');
  });

  it('names both medals, or one when they are the same', () => {
    const medal = {
      ref: 'member_medals.memberId' as const,
      competition: 'Jugend Wettkampf',
      date: '2026-04-26',
      keptMedal: 'gold',
      droppedMedal: 'bronze',
      kept: 'drop' as const
    };
    expect(conflictText(medal, t)).toBe(
      'page.members.merge.conflict.medal {"competition":"Jugend Wettkampf","kept":"medals.gold","dropped":"medals.bronze"}'
    );
    expect(conflictText({ ...medal, droppedMedal: 'gold' }, t)).toBe(
      'page.members.merge.conflict.medalSame {"competition":"Jugend Wettkampf","medal":"medals.gold"}'
    );
  });

  it('dates the exam day as the app does', () => {
    expect(
      conflictText(
        {
          ref: 'exam_candidates.member_id',
          title: 'Kyu-Prüfung',
          date: '2026-11-07',
          kept: 'keep',
          reason: 'sheet',
          removed: {
            status: 'invited',
            grade: '4. Kyu',
            trainer: 'Eva',
            note: 'Brille',
            staffNote: null
          }
        },
        t
      )
    ).toBe('page.members.merge.conflict.examSheet {"title":"Kyu-Prüfung","date":"07.11.2026"}');
  });

  it('still gives a line for a conflict added in SQL later', () => {
    const later = { ref: 'new_table.member_id', kept: 'keep' } as unknown as Parameters<
      typeof conflictText
    >[0];
    expect(conflictText(later, t)).toBe(
      'page.members.merge.conflict.other {"ref":"new_table.member_id"}'
    );
  });
});

describe('accountChanges', () => {
  const account = {
    userId: 'u1',
    email: 'a@test.ch',
    role: 'member' as const,
    before: true,
    after: true,
    findsBefore: true,
    findsAfter: true
  };

  it('lists only accounts the merge changes something for', () => {
    expect(
      accountChanges(
        result({
          accounts: [
            account,
            { ...account, userId: 'u2', after: false, findsAfter: false },
            { ...account, userId: 'u3', before: false },
            { ...account, userId: 'u4', role: 'trainer', findsAfter: false }
          ]
        })
      ).map((c) => [c.account.userId, c.change])
    ).toEqual([
      ['u2', 'losesAccess'],
      ['u3', 'gainsAccess'],
      ['u4', 'losesRecord']
    ]);
  });

  it('names a member account that keeps access but loses or finds the person', () => {
    // A parent who still gets in through another child
    expect(
      accountChanges(
        result({
          accounts: [
            { ...account, userId: 'u5', findsAfter: false },
            { ...account, userId: 'u6', findsBefore: false }
          ]
        })
      ).map((c) => [c.account.userId, c.change])
    ).toEqual([
      ['u5', 'losesRecord'],
      ['u6', 'gainsRecord']
    ]);
  });

  it('says nothing about an account that never got in and still does not', () => {
    // Waiting, so it finds nobody either (my_member_ids)
    const waiting = {
      ...account,
      before: false,
      after: false,
      findsBefore: false,
      findsAfter: false
    };
    expect(accountChanges(result({ accounts: [waiting] }))).toEqual([]);
  });
});

describe('mergeWithPhoto', () => {
  const uploaded = '2024-05-01T10:00:00.123Z';
  const keep = 4321;
  const drop = 10_000_005;
  const dropFile = '10000005_1714557600123.webp';
  const keepFile = '4321_1714557600123.webp';
  // As Storage answers: a file that does not exist, and a server error
  const notFound = { statusCode: '404', message: 'Object not found' };
  const serverError = { statusCode: '500', message: 'Internal Server Error' };

  function storage(copyError: unknown = null): AvatarStorage & {
    copy: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  } {
    return {
      copy: vi.fn().mockResolvedValue({ error: copyError }),
      remove: vi.fn().mockResolvedValue({ error: null })
    };
  }
  const withPhoto = (photo: MemberMergeResult['fields']['photo'], at: string | null = uploaded) =>
    result({ fields: { ...result().fields, photo, dropPhotoUploaded: at } });
  const takesPhoto = withPhoto('from_drop');
  // Failed copies are logged
  let quiet: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => quiet.mockRestore());

  it('copies the photo the database names before the merge and removes the dropped file after', async () => {
    const s = storage();
    const merge = vi.fn().mockResolvedValue(takesPhoto);
    await mergeWithPhoto(s, takesPhoto, keep, drop, merge);
    expect(s.copy).toHaveBeenCalledTimes(1);
    expect(s.copy).toHaveBeenCalledWith(dropFile, keepFile);
    expect(s.copy.mock.invocationCallOrder[0]).toBeLessThan(merge.mock.invocationCallOrder[0]);
    expect(s.remove).toHaveBeenCalledWith([dropFile]);
  });

  it('removes the copy again when the merge is refused', async () => {
    const s = storage();
    const merge = vi.fn().mockRejectedValue(new Error('EXAM_CONFLICT'));
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).rejects.toThrow('EXAM_CONFLICT');
    expect(s.remove).toHaveBeenCalledWith([keepFile]);
  });

  it('keeps the copy when the merge fails otherwise: it may have gone through', async () => {
    const s = storage();
    const merge = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).rejects.toThrow(
      'Failed to fetch'
    );
    expect(s.remove).not.toHaveBeenCalled();
  });

  it('removes an unused copy when the merge decided otherwise', async () => {
    const s = storage();
    const merge = vi.fn().mockResolvedValue(withPhoto('kept_both'));
    await mergeWithPhoto(s, takesPhoto, keep, drop, merge);
    expect(s.remove).toHaveBeenCalledWith([dropFile, keepFile]);
  });

  it('follows a photo changed between preview and merge', async () => {
    const s = storage();
    const newer = '2024-06-01T08:00:00.000Z';
    const merge = vi.fn().mockResolvedValue(withPhoto('from_drop', newer));
    await mergeWithPhoto(s, takesPhoto, keep, drop, merge);
    // The kept row points at the new photo: copied under its name before
    // anything goes, then the old file, the new source and the unused copy go
    expect(s.copy).toHaveBeenLastCalledWith(
      `10000005_${Date.parse(newer)}.webp`,
      `4321_${Date.parse(newer)}.webp`
    );
    expect(s.copy.mock.invocationCallOrder[1]).toBeLessThan(s.remove.mock.invocationCallOrder[0]);
    expect(s.remove).toHaveBeenCalledWith([
      dropFile,
      `10000005_${Date.parse(newer)}.webp`,
      keepFile
    ]);
  });

  it('keeps the new photo when copying it after the merge fails', async () => {
    const s = storage();
    s.copy.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: serverError });
    const newer = '2024-06-01T08:00:00.000Z';
    await mergeWithPhoto(
      s,
      takesPhoto,
      keep,
      drop,
      vi.fn().mockResolvedValue(withPhoto('from_drop', newer))
    );
    expect(s.remove).toHaveBeenCalledWith([dropFile, keepFile]);
  });

  it('keeps the dropped file when the copy fails for another reason than a missing file', async () => {
    const s = storage(serverError);
    const merge = vi.fn().mockResolvedValue(takesPhoto);
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).resolves.toBe(takesPhoto);
    // Tried again after the merge, then left alone
    expect(s.copy).toHaveBeenCalledTimes(2);
    expect(s.remove).not.toHaveBeenCalled();
  });

  it('keeps the dropped file when the copy throws', async () => {
    const s = storage();
    s.copy.mockRejectedValue(new Error('network'));
    const merge = vi.fn().mockResolvedValue(takesPhoto);
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).resolves.toBe(takesPhoto);
    expect(merge).toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it('copies after the merge when the copy before failed', async () => {
    const s = storage();
    s.copy.mockResolvedValueOnce({ error: serverError }).mockResolvedValueOnce({ error: null });
    await mergeWithPhoto(s, takesPhoto, keep, drop, vi.fn().mockResolvedValue(takesPhoto));
    expect(s.copy).toHaveBeenCalledTimes(2);
    expect(s.copy).toHaveBeenLastCalledWith(dropFile, keepFile);
    // Only once the second copy is there
    expect(s.copy.mock.invocationCallOrder[1]).toBeLessThan(s.remove.mock.invocationCallOrder[0]);
    expect(s.remove).toHaveBeenCalledWith([dropFile]);
  });

  it('copies after the merge when the photo was only taken there', async () => {
    const s = storage();
    // The preview saw the kept member's photo, which was removed before the merge
    await mergeWithPhoto(
      s,
      withPhoto('kept_both'),
      keep,
      drop,
      vi.fn().mockResolvedValue(takesPhoto)
    );
    expect(s.copy).toHaveBeenCalledTimes(1);
    expect(s.copy).toHaveBeenCalledWith(dropFile, keepFile);
    expect(s.remove).toHaveBeenCalledWith([dropFile]);
  });

  it('removes the dropped file when the kept member keeps its own photo', async () => {
    const s = storage();
    const keptBoth = withPhoto('kept_both');
    await mergeWithPhoto(s, keptBoth, keep, drop, vi.fn().mockResolvedValue(keptBoth));
    expect(s.copy).not.toHaveBeenCalled();
    expect(s.remove).toHaveBeenCalledWith([dropFile]);
  });

  it('merges anyway when there is no file to copy (thumbnail only)', async () => {
    const s = storage(notFound);
    const merge = vi.fn().mockResolvedValue(takesPhoto);
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).resolves.toBe(takesPhoto);
    expect(s.remove).toHaveBeenCalledWith([dropFile]);
  });

  it('does not fail the merge when removing fails', async () => {
    const s = storage();
    s.remove.mockRejectedValue(new Error('network'));
    const merge = vi.fn().mockResolvedValue(takesPhoto);
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).resolves.toBe(takesPhoto);
  });

  it('touches no files without photos', async () => {
    const s = storage();
    const merge = vi.fn().mockResolvedValue(result());
    await mergeWithPhoto(s, result(), keep, 7, merge);
    expect(s.copy).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });
});
