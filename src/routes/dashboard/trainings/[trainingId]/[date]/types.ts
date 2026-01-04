import type { Member, TrainerRole } from '$lib/models';

export interface MMember extends Member {
  isPresent: boolean;
  trainerRole: TrainerRole;
}
