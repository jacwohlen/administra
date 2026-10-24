import type { CandidateState } from '$lib/examUtils';

// One look for the Q-Prüfung states and scores on every page (sheet, exam
// day, member area), built from the app's chip and preset colours.

/** Chip colours per candidate state: neutral → called up → running → result. */
export const EXAM_STATE_CLASS: Record<CandidateState, string> = {
  registered: 'bg-surface-100-900 text-surface-900-50',
  invited: 'preset-tonal-secondary',
  grading: 'preset-tonal-warning',
  passed: 'preset-tonal-success',
  failed: 'preset-tonal-error',
  withdrawn: 'bg-surface-100-900 text-surface-600-400'
};

/** A given score 0 / 1 / 2 (red, yellow, teal); the same on the keys, chips and legend. */
export const SCORE_TONES = [
  'preset-filled-error-500',
  'preset-filled-warning-500',
  'preset-filled-success-500'
] as const;

/** A side not scored yet. */
export const SCORE_EMPTY = 'bg-surface-100-900 text-surface-600-400';
