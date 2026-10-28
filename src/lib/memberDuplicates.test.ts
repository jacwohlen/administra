import { describe, expect, it } from 'vitest';
import {
  findDuplicatePairs,
  inProvider,
  isTrialOrigin,
  linkStates,
  mergeOrderProblem,
  nameKey,
  suggestKeep,
  type DuplicateCandidate
} from './memberDuplicates';

const member = (m: Partial<DuplicateCandidate> & { id: number }): DuplicateCandidate => ({
  firstname: 'Mira',
  lastname: 'Dupont',
  labels: [],
  membership_status: 'active',
  ...m
});

describe('linkStates / inProvider', () => {
  it('reads an active link as in Webling, a gone one as not', () => {
    const links = linkStates([
      { member_id: 5001, gone_at: null },
      { member_id: 5002, gone_at: '2026-10-01T00:00:00Z' }
    ]);
    expect(inProvider(5001, links.get(5001))).toBe(true);
    expect(inProvider(5002, links.get(5002))).toBe(false);
  });

  it('counts an unlinked Webling id as in Webling, like the database', () => {
    expect(inProvider(5003, undefined)).toBe(true);
    expect(inProvider(999, undefined)).toBe(false);
    expect(inProvider(10_000_001, undefined)).toBe(false);
  });

  it('prefers an active link over a gone one of the same member', () => {
    const links = linkStates([
      { member_id: 7, gone_at: '2026-01-01T00:00:00Z' },
      { member_id: 7, gone_at: null }
    ]);
    expect(links.get(7)).toBe('active');
  });
});

describe('isTrialOrigin', () => {
  it('knows both trial labels and the registration date', () => {
    expect(isTrialOrigin(member({ id: 1, labels: ['probetraining'] }))).toBe(true);
    expect(isTrialOrigin(member({ id: 1, labels: ['Probetraining'] }))).toBe(true);
    expect(isTrialOrigin(member({ id: 1, trialRegisteredAt: '2026-01-01T00:00:00Z' }))).toBe(true);
    expect(isTrialOrigin(member({ id: 1, labels: ['Aktiv'] }))).toBe(false);
  });
});

describe('nameKey', () => {
  it('ignores word order, case and umlauts', () => {
    expect(nameKey({ firstname: 'Kim', lastname: 'Keller' })).toBe(
      nameKey({ firstname: 'KELLER', lastname: 'kim' })
    );
    expect(nameKey({ firstname: 'Jürg', lastname: 'Müller' })).toBe('jurg muller');
    expect(nameKey({ firstname: 'Anna-Lena', lastname: 'Roth' })).toBe('anna lena roth');
  });

  it('needs two words: a first name alone matches too many people', () => {
    expect(nameKey({ firstname: 'Beni', lastname: '' })).toBeNull();
    expect(nameKey({ firstname: ' ', lastname: ' ' })).toBeNull();
  });
});

describe('mergeOrderProblem', () => {
  it('mirrors the refusals of merge_members()', () => {
    expect(mergeOrderProblem(true, true)).toBe('BOTH_IN_PROVIDER');
    expect(mergeOrderProblem(false, true)).toBe('KEEP_PROVIDER_ROW');
    expect(mergeOrderProblem(true, false)).toBeNull();
    expect(mergeOrderProblem(false, false)).toBeNull();
  });
});

describe('suggestKeep', () => {
  const none = new Map();

  it('keeps the Webling row over a trial registration', () => {
    const trial = member({ id: 10_000_005, labels: ['probetraining'], membership_status: 'trial' });
    const webling = member({ id: 4321, labels: ['Aktiv'] });
    expect(suggestKeep(trial, webling, linkStates([{ member_id: 4321, gone_at: null }]))).toEqual([
      webling,
      trial
    ]);
  });

  it('keeps a member over a trial registration, then the unarchived, then the older id', () => {
    const a = member({ id: 120 });
    const b = member({ id: 10_000_010, trialRegisteredAt: '2026-01-01T00:00:00Z' });
    expect(suggestKeep(b, a, none)[0]).toBe(a);
    const archived = member({ id: 50, archivedAt: '2026-01-01T00:00:00Z' });
    expect(suggestKeep(archived, a, none)[0]).toBe(a);
    expect(suggestKeep(member({ id: 300 }), member({ id: 200 }), none)[0].id).toBe(200);
  });

  it('keeps an active member over a non-member', () => {
    const non = member({ id: 100, membership_status: 'non_member' });
    const active = member({ id: 200 });
    expect(suggestKeep(non, active, none)[0]).toBe(active);
  });
});

describe('findDuplicatePairs', () => {
  const links = linkStates([
    { member_id: 4321, gone_at: null },
    { member_id: 4400, gone_at: null }
  ]);

  it('pairs same name and birthday, folding umlauts and case', () => {
    const pairs = findDuplicatePairs(
      [
        member({ id: 101, firstname: 'Jürg', lastname: 'Müller', birthday: '2010-05-01' }),
        member({ id: 102, firstname: 'jurg', lastname: 'MUELLER', birthday: '2010-05-01' }),
        member({ id: 103, firstname: 'Jürg', lastname: 'Müller', birthday: '1980-01-01' })
      ],
      new Map()
    );
    expect(pairs.map((p) => [p.keep.id, p.drop.id, p.reasons])).toEqual([
      [101, 102, ['name_birthday']]
    ]);
  });

  it('pairs a shared e-mail only with the same first name (siblings share one)', () => {
    const pairs = findDuplicatePairs(
      [
        member({ id: 103, firstname: 'Leo', lastname: 'Scott', email: 'Parent@example.com ' }),
        member({ id: 107, firstname: 'Emma', lastname: 'Scott', email: 'parent@example.com' }),
        member({ id: 108, firstname: 'Leo', lastname: 'Scott-Meier', email: 'parent@example.com' })
      ],
      new Map()
    );
    expect(pairs.map((p) => [p.keep.id, p.drop.id, p.reasons])).toEqual([
      [103, 108, ['email_name']]
    ]);
  });

  it('does not pair twins: same e-mail and birthday, other first name', () => {
    const twins = [
      member({ id: 103, firstname: 'Leo', birthday: '2015-02-03', email: 'parent@example.com' }),
      member({ id: 104, firstname: 'Mia', birthday: '2015-02-03', email: 'parent@example.com' })
    ];
    expect(findDuplicatePairs(twins, new Map())).toEqual([]);
  });

  it('pairs names written the other way round', () => {
    const pairs = findDuplicatePairs(
      [
        member({ id: 120, firstname: 'Kim', lastname: 'Keller', birthday: '2011-01-01' }),
        member({ id: 121, firstname: 'Keller', lastname: 'Kim', birthday: '2011-01-01' })
      ],
      new Map()
    );
    expect(pairs.map((p) => p.reasons)).toEqual([['name_birthday']]);
  });

  it('pairs a trial registration with an app row of the same name too', () => {
    const trial = member({ id: 10_000_006, trialRegisteredAt: '2025-01-01T00:00:00Z' });
    const converted = member({ id: 130 });
    const [pair] = findDuplicatePairs([trial, converted], new Map());
    expect([pair.keep, pair.drop, pair.reasons]).toEqual([converted, trial, ['trial_name']]);
  });

  it('does not pair two trial registrations by name alone', () => {
    const a = member({ id: 10_000_007, labels: ['probetraining'] });
    const b = member({ id: 10_000_008, labels: ['probetraining'] });
    expect(findDuplicatePairs([a, b], new Map())).toEqual([]);
  });

  it('pairs a trial registration with a member of the same name, the Webling row kept', () => {
    const trial = member({ id: 10_000_005, labels: ['probetraining'], membership_status: 'trial' });
    const webling = member({ id: 4321, labels: ['Aktiv'], birthday: '2012-03-04' });
    const [pair] = findDuplicatePairs([trial, webling], links);
    expect(pair.keep).toBe(webling);
    expect(pair.drop).toBe(trial);
    expect(pair.reasons).toEqual(['trial_name']);
    expect(pair.blocked).toBe(false);
  });

  it('collects every reason of a pair once', () => {
    const a = member({ id: 4321, birthday: '2012-03-04', email: 'mira@test.ch' });
    const b = member({
      id: 10_000_005,
      birthday: '2012-03-04',
      email: 'mira@test.ch',
      labels: ['probetraining']
    });
    const [pair] = findDuplicatePairs([a, b], links);
    expect(pair.reasons).toEqual(['email_name', 'name_birthday', 'trial_name']);
  });

  it('lists two Webling rows as blocked, after the others', () => {
    const pairs = findDuplicatePairs(
      [
        member({ id: 4321, lastname: 'Anders', birthday: '2000-01-01' }),
        member({ id: 4400, lastname: 'Anders', birthday: '2000-01-01' }),
        member({ id: 201, lastname: 'Zimmer', birthday: '2001-01-01' }),
        member({ id: 202, lastname: 'Zimmer', birthday: '2001-01-01' })
      ],
      links
    );
    expect(pairs.map((p) => [p.keep.id, p.blocked])).toEqual([
      [201, false],
      [4321, true]
    ]);
  });

  it('ignores rows without birthday or e-mail for those reasons', () => {
    expect(findDuplicatePairs([member({ id: 1 }), member({ id: 2 })], new Map())).toEqual([]);
  });
});
