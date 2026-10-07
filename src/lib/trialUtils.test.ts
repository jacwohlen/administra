import { describe, it, expect } from 'vitest';
import {
  trialProgress,
  trainingMatchesAge,
  splitTrainingsByAge,
  matchesTrialTab,
  isTrialInactive,
  sortTrialMembers,
  elapsedSince,
  upcomingTrainingDates
} from './trialUtils';
import type { Training, TrialMember } from './models';

function training(partial: Partial<Training> & { id: string }): Training {
  return {
    title: 'Training',
    dateFrom: '18:00',
    dateTo: '19:00',
    weekday: 'Monday',
    section: 'Judo',
    participants: [],
    ...partial
  };
}

describe('trialProgress', () => {
  const threshold = 3;

  it('reports no attendance yet', () => {
    expect(trialProgress(0, threshold)).toBe('none');
  });

  it('reports an ongoing trial below the threshold', () => {
    expect(trialProgress(1, threshold)).toBe('active');
    expect(trialProgress(threshold - 1, threshold)).toBe('active');
  });

  it('flags conversion once the threshold is reached', () => {
    expect(trialProgress(threshold, threshold)).toBe('convert');
    expect(trialProgress(threshold + 5, threshold)).toBe('convert');
  });

  it('respects whatever threshold is configured', () => {
    expect(trialProgress(3, 5)).toBe('active');
    expect(trialProgress(5, 5)).toBe('convert');
    expect(trialProgress(1, 1)).toBe('convert');
  });
});

describe('trainingMatchesAge', () => {
  const kids = training({ id: '1', ageFrom: 5, ageTo: 7 });

  it('matches inside the range, bounds included', () => {
    expect(trainingMatchesAge(kids, 5)).toBe(true);
    expect(trainingMatchesAge(kids, 6)).toBe(true);
    expect(trainingMatchesAge(kids, 7)).toBe(true);
  });

  it('does not match outside the range', () => {
    expect(trainingMatchesAge(kids, 4)).toBe(false);
    expect(trainingMatchesAge(kids, 8)).toBe(false);
  });

  it('never matches when the age is unknown', () => {
    expect(trainingMatchesAge(kids, null)).toBe(false);
  });

  it('never matches when the training has no range configured', () => {
    expect(trainingMatchesAge(training({ id: '2' }), 6)).toBe(false);
    expect(trainingMatchesAge(training({ id: '3', ageFrom: 5 }), 6)).toBe(false);
    expect(trainingMatchesAge(training({ id: '4', ageTo: 7 }), 6)).toBe(false);
  });
});

describe('splitTrainingsByAge', () => {
  const kids = training({ id: '1', ageFrom: 5, ageTo: 7 });
  const youth = training({ id: '2', ageFrom: 13, ageTo: 16 });
  const open = training({ id: '3' });

  it('separates matching trainings from the rest', () => {
    const { suggested, others } = splitTrainingsByAge([kids, youth, open], 6);
    expect(suggested.map((t) => t.id)).toEqual(['1']);
    expect(others.map((t) => t.id)).toEqual(['2', '3']);
  });

  it('skips already assigned trainings entirely', () => {
    const { suggested, others } = splitTrainingsByAge([kids, youth, open], 6, new Set([1, 3]));
    expect(suggested).toEqual([]);
    expect(others.map((t) => t.id)).toEqual(['2']);
  });

  it('suggests nothing when the age is unknown', () => {
    const { suggested, others } = splitTrainingsByAge([kids, youth], null);
    expect(suggested).toEqual([]);
    expect(others).toHaveLength(2);
  });

  it('can suggest several overlapping trainings', () => {
    const alsoKids = training({ id: '5', ageFrom: 6, ageTo: 9 });
    const { suggested } = splitTrainingsByAge([kids, alsoKids, youth], 6);
    expect(suggested.map((t) => t.id)).toEqual(['1', '5']);
  });
});

function candidate(partial: Partial<TrialMember> & { id: number }): TrialMember {
  return {
    firstname: 'Max',
    lastname: 'Muster',
    labels: ['probetraining'],
    attendedCount: 0,
    trialStatus: 'new',
    ...partial
  };
}

describe('matchesTrialTab', () => {
  const threshold = 3;

  it('filters by status', () => {
    const m = candidate({ id: 1, trialStatus: 'waitlist' });
    expect(matchesTrialTab(m, 'waitlist', threshold, 60)).toBe(true);
    expect(matchesTrialTab(m, 'new', threshold, 60)).toBe(false);
    expect(matchesTrialTab(m, 'all', threshold, 60)).toBe(true);
  });

  it('lists candidates due to sign up unless they cancelled', () => {
    const due = candidate({ id: 1, trialStatus: 'assigned', attendedCount: 3 });
    const cancelled = candidate({ id: 2, trialStatus: 'cancelled', attendedCount: 5 });
    const early = candidate({ id: 3, trialStatus: 'assigned', attendedCount: 1 });
    expect(matchesTrialTab(due, 'convert', threshold, 60)).toBe(true);
    expect(matchesTrialTab(cancelled, 'convert', threshold, 60)).toBe(false);
    expect(matchesTrialTab(early, 'convert', threshold, 60)).toBe(false);
  });
});

describe('isTrialInactive', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('flags assigned candidates who stopped coming', () => {
    const gone = candidate({ id: 1, trialStatus: 'assigned', lastAttendedAt: '2026-07-01' });
    const recent = candidate({ id: 2, trialStatus: 'assigned', lastAttendedAt: '2026-09-20' });
    expect(isTrialInactive(gone, 60, now)).toBe(true);
    expect(isTrialInactive(recent, 60, now)).toBe(false);
  });

  it('uses the configured number of days', () => {
    const m = candidate({ id: 1, trialStatus: 'assigned', lastAttendedAt: '2026-09-01' });
    expect(isTrialInactive(m, 60, now)).toBe(false);
    expect(isTrialInactive(m, 30, now)).toBe(true);
  });

  it('falls back to the status change for candidates who never came', () => {
    const never = candidate({
      id: 1,
      trialStatus: 'assigned',
      trialStatusChangedAt: '2026-06-01T10:00:00Z'
    });
    expect(isTrialInactive(never, 60, now)).toBe(true);
  });

  it('ignores new, waiting, cancelled and archived candidates', () => {
    const old = { lastAttendedAt: '2026-01-01' };
    expect(isTrialInactive(candidate({ id: 1, trialStatus: 'new', ...old }), 60, now)).toBe(false);
    expect(isTrialInactive(candidate({ id: 2, trialStatus: 'waitlist', ...old }), 60, now)).toBe(
      false
    );
    expect(isTrialInactive(candidate({ id: 3, trialStatus: 'cancelled', ...old }), 60, now)).toBe(
      false
    );
    const archived = candidate({
      id: 4,
      trialStatus: 'assigned',
      archivedAt: '2026-09-01T10:00:00Z',
      ...old
    });
    expect(isTrialInactive(archived, 60, now)).toBe(false);
  });
});

describe('matchesTrialTab with archive and inactivity', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('shows archived candidates only in the archive', () => {
    const m = candidate({ id: 1, trialStatus: 'cancelled', archivedAt: '2026-09-01T10:00:00Z' });
    expect(matchesTrialTab(m, 'archived', 3, 60, now)).toBe(true);
    expect(matchesTrialTab(m, 'cancelled', 3, 60, now)).toBe(false);
    expect(matchesTrialTab(m, 'all', 3, 60, now)).toBe(false);
  });

  it('moves inactive candidates out of the sign-up queue', () => {
    const m = candidate({
      id: 1,
      trialStatus: 'assigned',
      attendedCount: 4,
      lastAttendedAt: '2026-05-01'
    });
    expect(matchesTrialTab(m, 'inactive', 3, 60, now)).toBe(true);
    expect(matchesTrialTab(m, 'convert', 3, 60, now)).toBe(false);
    expect(matchesTrialTab(m, 'assigned', 3, 60, now)).toBe(true);
  });
});

describe('sortTrialMembers', () => {
  const members = [
    candidate({ id: 1, lastname: 'B', trialRegisteredAt: '2026-09-01T10:00:00Z' }),
    candidate({ id: 2, lastname: 'A', trialRegisteredAt: '2026-09-20T10:00:00Z' }),
    candidate({ id: 3, lastname: 'C' }),
    candidate({ id: 4, lastname: 'D', trialRegisteredAt: '2026-08-15T10:00:00Z' })
  ];

  it('shows the newest registration first', () => {
    expect(sortTrialMembers(members, 'new').map((m) => m.id)).toEqual([2, 1, 4, 3]);
  });

  it('serves the waiting list first come, first served', () => {
    expect(sortTrialMembers(members, 'waitlist').map((m) => m.id)).toEqual([4, 1, 2, 3]);
  });

  it('does not reorder its input', () => {
    sortTrialMembers(members, 'waitlist');
    expect(members.map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('elapsedSince', () => {
  const now = new Date(2026, 8, 27, 12, 0);

  it('reports today', () => {
    expect(elapsedSince(new Date(2026, 8, 27, 8, 0).toISOString(), now)).toEqual({
      unit: 'today',
      count: 0
    });
  });

  it('counts days, then weeks, then months', () => {
    expect(elapsedSince(new Date(2026, 8, 24).toISOString(), now)).toEqual({
      unit: 'days',
      count: 3
    });
    expect(elapsedSince(new Date(2026, 8, 6).toISOString(), now)).toEqual({
      unit: 'weeks',
      count: 3
    });
    expect(elapsedSince(new Date(2026, 5, 27).toISOString(), now)).toEqual({
      unit: 'months',
      count: 3
    });
  });

  it('never goes negative', () => {
    expect(elapsedSince(new Date(2026, 8, 30).toISOString(), now).unit).toBe('today');
  });
});

describe('upcomingTrainingDates', () => {
  // Tuesday, 6 October 2026, 17:00 local time
  const now = new Date(2026, 9, 6, 17, 0);

  it('lists the next sessions of the weekday', () => {
    expect(upcomingTrainingDates('Friday', '18:00', 3, now)).toEqual([
      '2026-10-09',
      '2026-10-16',
      '2026-10-23'
    ]);
  });

  it('includes today while the training has not started', () => {
    expect(upcomingTrainingDates('Tuesday', '18:00', 2, now)).toEqual(['2026-10-06', '2026-10-13']);
  });

  it('skips today once the training has started', () => {
    expect(upcomingTrainingDates('Tuesday', '17:00', 1, now)).toEqual(['2026-10-13']);
    expect(upcomingTrainingDates('Tuesday', null, 1, now)).toEqual(['2026-10-13']);
  });

  it('crosses month and year ends', () => {
    expect(upcomingTrainingDates('Monday', '18:00', 2, new Date(2026, 11, 27))).toEqual([
      '2026-12-28',
      '2027-01-04'
    ]);
  });

  it('returns nothing for an unknown weekday', () => {
    expect(upcomingTrainingDates('Montag', '18:00', 3, now)).toEqual([]);
  });
});
