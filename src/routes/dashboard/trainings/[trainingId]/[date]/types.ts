import type { Member, TrainerRole } from '$lib/models';

export interface MMember extends Member {
  isPresent: boolean;
  trainerRole: TrainerRole;
  /** Boolean array representing last N training dates (oldest first). true = attended. */
  streak: boolean[];
}
