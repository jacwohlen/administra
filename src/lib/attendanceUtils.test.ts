import { describe, it, expect } from 'vitest';
import { filterAndSortParticipants, getAttendanceStats } from './attendanceUtils';

interface TestParticipant {
  firstname: string;
  lastname: string;
  isPresent: boolean;
  trainerRole: string;
}

function makeParticipant(overrides: Partial<TestParticipant> = {}): TestParticipant {
  return {
    firstname: 'John',
    lastname: 'Doe',
    isPresent: false,
    trainerRole: 'attendee',
    ...overrides
  };
}

describe('filterAndSortParticipants', () => {
  it('returns all participants when search is empty', () => {
    const participants = [
      makeParticipant({ firstname: 'Alice', lastname: 'Smith' }),
      makeParticipant({ firstname: 'Bob', lastname: 'Jones' })
    ];
    const result = filterAndSortParticipants(participants, '');
    expect(result).toHaveLength(2);
  });

  it('filters by last name prefix', () => {
    const participants = [
      makeParticipant({ firstname: 'Alice', lastname: 'Smith' }),
      makeParticipant({ firstname: 'Bob', lastname: 'Jones' })
    ];
    const result = filterAndSortParticipants(participants, 'Sm');
    expect(result).toHaveLength(1);
    expect(result[0].lastname).toBe('Smith');
  });

  it('filters by first name prefix', () => {
    const participants = [
      makeParticipant({ firstname: 'Alice', lastname: 'Smith' }),
      makeParticipant({ firstname: 'Bob', lastname: 'Jones' })
    ];
    const result = filterAndSortParticipants(participants, 'Bo');
    expect(result).toHaveLength(1);
    expect(result[0].firstname).toBe('Bob');
  });

  it('is case-insensitive', () => {
    const participants = [makeParticipant({ firstname: 'Alice', lastname: 'Smith' })];
    expect(filterAndSortParticipants(participants, 'alice')).toHaveLength(1);
    expect(filterAndSortParticipants(participants, 'ALICE')).toHaveLength(1);
    expect(filterAndSortParticipants(participants, 'smith')).toHaveLength(1);
  });

  it('sorts present participants before absent ones', () => {
    const participants = [
      makeParticipant({ firstname: 'Alice', isPresent: false }),
      makeParticipant({ firstname: 'Bob', isPresent: true }),
      makeParticipant({ firstname: 'Charlie', isPresent: false }),
      makeParticipant({ firstname: 'Diana', isPresent: true })
    ];
    const result = filterAndSortParticipants(participants, '');
    expect(result[0].firstname).toBe('Bob');
    expect(result[1].firstname).toBe('Diana');
    expect(result[2].firstname).toBe('Alice');
    expect(result[3].firstname).toBe('Charlie');
  });

  it('returns empty array when no matches', () => {
    const participants = [makeParticipant({ firstname: 'Alice', lastname: 'Smith' })];
    expect(filterAndSortParticipants(participants, 'xyz')).toHaveLength(0);
  });

  it('handles empty participants list', () => {
    expect(filterAndSortParticipants([], 'test')).toEqual([]);
  });

  it('matches only prefix, not substring', () => {
    const participants = [makeParticipant({ firstname: 'Alice', lastname: 'Smith' })];
    expect(filterAndSortParticipants(participants, 'lic')).toHaveLength(0);
    expect(filterAndSortParticipants(participants, 'mit')).toHaveLength(0);
  });
});

describe('getAttendanceStats', () => {
  it('returns zero stats for empty list', () => {
    const stats = getAttendanceStats([]);
    expect(stats).toEqual({
      present: 0,
      total: 0,
      mainTrainers: 0,
      assistants: 0,
      hasMainTrainer: false
    });
  });

  it('counts present participants correctly', () => {
    const participants = [
      makeParticipant({ isPresent: true }),
      makeParticipant({ isPresent: false }),
      makeParticipant({ isPresent: true })
    ];
    const stats = getAttendanceStats(participants);
    expect(stats.present).toBe(2);
    expect(stats.total).toBe(3);
  });

  it('counts trainer roles correctly', () => {
    const participants = [
      makeParticipant({ isPresent: true, trainerRole: 'main_trainer' }),
      makeParticipant({ isPresent: true, trainerRole: 'assistant' }),
      makeParticipant({ isPresent: true, trainerRole: 'attendee' }),
      makeParticipant({ isPresent: false, trainerRole: 'main_trainer' }) // absent, not counted
    ];
    const stats = getAttendanceStats(participants);
    expect(stats.mainTrainers).toBe(1);
    expect(stats.assistants).toBe(1);
    expect(stats.hasMainTrainer).toBe(true);
  });

  it('hasMainTrainer is false when no main trainer is present', () => {
    const participants = [
      makeParticipant({ isPresent: true, trainerRole: 'attendee' }),
      makeParticipant({ isPresent: true, trainerRole: 'assistant' })
    ];
    const stats = getAttendanceStats(participants);
    expect(stats.hasMainTrainer).toBe(false);
  });

  it('does not count absent trainers', () => {
    const participants = [
      makeParticipant({ isPresent: false, trainerRole: 'main_trainer' }),
      makeParticipant({ isPresent: false, trainerRole: 'assistant' })
    ];
    const stats = getAttendanceStats(participants);
    expect(stats.mainTrainers).toBe(0);
    expect(stats.assistants).toBe(0);
    expect(stats.hasMainTrainer).toBe(false);
  });
});
