import type { Member, TrainerRole } from '#lib/models.ts';

export interface MMember extends Member {
  isPresent: boolean;
  trainerRole: TrainerRole;
  /** Boolean array representing last N training dates (oldest first). true = attended. */
  streak: boolean[];
}
