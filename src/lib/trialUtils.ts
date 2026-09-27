import type { Training, TrialMember, TrialStatus } from './models';

export type TrialProgress = 'none' | 'active' | 'convert';

/**
 * Where a candidate stands in their trial. `threshold` is the number of
 * sessions after which they are expected to sign up as a member — the
 * configured value is `clubConfig.trialSessionThreshold`. It is passed in
 * rather than imported here so this module stays free of SvelteKit runtime
 * imports and can be unit-tested without mocking.
 */
export function trialProgress(attendedCount: number, threshold: number): TrialProgress {
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

/** Tabs of the trial overview: one per status, plus everyone and the candidates due to sign up. */
export type TrialTab = 'all' | TrialStatus | 'convert';

export function matchesTrialTab(member: TrialMember, tab: TrialTab, threshold: number): boolean {
  if (tab === 'all') return true;
  if (tab === 'convert') {
    return (
      member.trialStatus !== 'cancelled' &&
      trialProgress(member.attendedCount, threshold) === 'convert'
    );
  }
  return member.trialStatus === tab;
}

/**
 * The waiting list is worked first come, first served, so it lists the
 * longest-waiting candidate first. Everything else shows the newest
 * registration first. Candidates without a registration date go last.
 */
export function sortTrialMembers(members: TrialMember[], tab: TrialTab): TrialMember[] {
  const oldestFirst = tab === 'waitlist';
  return [...members].sort((a, b) => {
    const ta = a.trialRegisteredAt ? Date.parse(a.trialRegisteredAt) : null;
    const tb = b.trialRegisteredAt ? Date.parse(b.trialRegisteredAt) : null;
    if (ta === tb) return a.lastname.localeCompare(b.lastname);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return oldestFirst ? ta - tb : tb - ta;
  });
}

export type ElapsedUnit = 'today' | 'days' | 'weeks' | 'months';

/** Coarse time since a date, for "registered 3 weeks ago" style labels. */
export function elapsedSince(
  iso: string,
  now: Date = new Date()
): { unit: ElapsedUnit; count: number } {
  const start = new Date(iso);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.round((today - startDay) / 86_400_000));
  if (days === 0) return { unit: 'today', count: 0 };
  if (days < 14) return { unit: 'days', count: days };
  if (days < 61) return { unit: 'weeks', count: Math.floor(days / 7) };
  return { unit: 'months', count: Math.floor(days / 30) };
}
