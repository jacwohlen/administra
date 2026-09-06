import type { Training } from './models';

/**
 * How many trial sessions a candidate may attend before they are expected to
 * sign up as a proper member. Reaching it flags the candidate in the overview.
 */
export const TRIAL_SESSION_THRESHOLD = 3;

export type TrialStatus = 'none' | 'active' | 'convert';

export function trialStatus(attendedCount: number): TrialStatus {
  if (attendedCount >= TRIAL_SESSION_THRESHOLD) return 'convert';
  if (attendedCount <= 0) return 'none';
  return 'active';
}

/** A training suggests itself when the candidate's age falls inside its declared range. */
export function trainingMatchesAge(training: Training, age: number | null): boolean {
  if (age === null) return false;
  const { ageFrom, ageTo } = training;
  if (ageFrom === undefined || ageFrom === null) return false;
  if (ageTo === undefined || ageTo === null) return false;
  return age >= ageFrom && age <= ageTo;
}

/**
 * Splits trainings into age-based suggestions and the rest, skipping the ones
 * the candidate is already assigned to.
 */
export function splitTrainingsByAge(
  trainings: Training[],
  age: number | null,
  exclude: Set<number> = new Set()
): { suggested: Training[]; others: Training[] } {
  const suggested: Training[] = [];
  const others: Training[] = [];
  for (const t of trainings) {
    if (exclude.has(Number(t.id))) continue;
    if (trainingMatchesAge(t, age)) suggested.push(t);
    else others.push(t);
  }
  return { suggested, others };
}
