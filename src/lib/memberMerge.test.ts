import { describe, expect, it, vi } from 'vitest';
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
      'training_plan_sessions.trainer_id',
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
          reason: 'sheet'
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

  it('says nothing about an account that never got in and still does not', () => {
    expect(
      accountChanges(
        result({ accounts: [{ ...account, before: false, after: false, findsBefore: false }] })
      )
    ).toEqual([]);
  });
});

describe('mergeWithPhoto', () => {
  const uploaded = '2024-05-01T10:00:00.123Z';
  const keep = 4321;
  const drop = 10_000_005;

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

  it('copies the photo the database names before the merge and removes the dropped file after', async () => {
    const s = storage();
    const merge = vi.fn().mockResolvedValue(takesPhoto);
    await mergeWithPhoto(s, takesPhoto, keep, drop, merge);
    expect(s.copy).toHaveBeenCalledWith('10000005_1714557600123.webp', '4321_1714557600123.webp');
    expect(s.copy.mock.invocationCallOrder[0]).toBeLessThan(merge.mock.invocationCallOrder[0]);
    expect(s.remove).toHaveBeenCalledWith(['10000005_1714557600123.webp']);
  });

  it('removes the copy again when the merge fails', async () => {
    const s = storage();
    const merge = vi.fn().mockRejectedValue(new Error('EXAM_CONFLICT'));
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).rejects.toThrow('EXAM_CONFLICT');
    expect(s.remove).toHaveBeenCalledWith(['4321_1714557600123.webp']);
  });

  it('removes an unused copy when the merge decided otherwise', async () => {
    const s = storage();
    const merge = vi.fn().mockResolvedValue(withPhoto('kept_both'));
    await mergeWithPhoto(s, takesPhoto, keep, drop, merge);
    expect(s.remove).toHaveBeenCalledWith([
      '10000005_1714557600123.webp',
      '4321_1714557600123.webp'
    ]);
  });

  it('follows a photo changed between preview and merge', async () => {
    const s = storage();
    const newer = '2024-06-01T08:00:00.000Z';
    const merge = vi.fn().mockResolvedValue(withPhoto('from_drop', newer));
    await mergeWithPhoto(s, takesPhoto, keep, drop, merge);
    // The copy names a file the kept row does not point at: both old files go
    expect(s.remove).toHaveBeenCalledWith([
      '10000005_1714557600123.webp',
      `10000005_${Date.parse(newer)}.webp`,
      '4321_1714557600123.webp'
    ]);
  });

  it('removes the dropped file when the kept member keeps its own photo', async () => {
    const s = storage();
    const keptBoth = withPhoto('kept_both');
    await mergeWithPhoto(s, keptBoth, keep, drop, vi.fn().mockResolvedValue(keptBoth));
    expect(s.copy).not.toHaveBeenCalled();
    expect(s.remove).toHaveBeenCalledWith(['10000005_1714557600123.webp']);
  });

  it('merges anyway when there is no file to copy (thumbnail only)', async () => {
    const s = storage({ message: 'Object not found' });
    const merge = vi.fn().mockResolvedValue(takesPhoto);
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).resolves.toBe(takesPhoto);
    expect(s.remove).toHaveBeenCalledWith(['10000005_1714557600123.webp']);
  });

  it('does not fail the merge when removing fails', async () => {
    const s = storage();
    s.remove.mockRejectedValue(new Error('network'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const merge = vi.fn().mockResolvedValue(takesPhoto);
    await expect(mergeWithPhoto(s, takesPhoto, keep, drop, merge)).resolves.toBe(takesPhoto);
    spy.mockRestore();
  });

  it('touches no files without photos', async () => {
    const s = storage();
    const merge = vi.fn().mockResolvedValue(result());
    await mergeWithPhoto(s, result(), keep, 7, merge);
    expect(s.copy).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });
});
