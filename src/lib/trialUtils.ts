import type { Training } from './models';

export type TrialStatus = 'none' | 'active' | 'convert';

/**
 * Where a candidate stands in their trial. `threshold` is the number of
 * sessions after which they are expected to sign up as a member — the
 * configured value is `clubConfig.trialSessionThreshold`. It is passed in
 * rather than imported here so this module stays free of SvelteKit runtime
 * imports and can be unit-tested without mocking.
 */
export function trialStatus(attendedCount: number, threshold: number): TrialStatus {
  if (attendedCount >= threshold) return 'convert';
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
