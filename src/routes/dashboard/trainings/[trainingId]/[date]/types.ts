import type { Member, TrainerRole, TrialStatus } from '#lib/models.ts';

export interface MMember extends Member {
  isPresent: boolean;
  trainerRole: TrainerRole;
  /** Boolean array representing last N training dates (oldest first). true = attended. */
  streak: boolean[];
}

/** A trial candidate on the checklist (view_trial_members) */
export interface ChecklistTrial {
  status: TrialStatus | null;
  /** Confirmed on the status page that they come */
  confirmedAt: string | null;
  /** First trial session in this training (YYYY-MM-DD), when one was picked */
  startDate: string | null;
}
