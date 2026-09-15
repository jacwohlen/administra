import { describe, it, expect } from 'vitest';
import { trialStatus, trainingMatchesAge, splitTrainingsByAge } from './trialUtils';
import type { Training } from './models';

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

describe('trialStatus', () => {
  const threshold = 3;

  it('reports no attendance yet', () => {
    expect(trialStatus(0, threshold)).toBe('none');
  });

  it('reports an ongoing trial below the threshold', () => {
    expect(trialStatus(1, threshold)).toBe('active');
    expect(trialStatus(threshold - 1, threshold)).toBe('active');
  });

  it('flags conversion once the threshold is reached', () => {
    expect(trialStatus(threshold, threshold)).toBe('convert');
    expect(trialStatus(threshold + 5, threshold)).toBe('convert');
  });

  it('respects whatever threshold is configured', () => {
    expect(trialStatus(3, 5)).toBe('active');
    expect(trialStatus(5, 5)).toBe('convert');
    expect(trialStatus(1, 1)).toBe('convert');
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
