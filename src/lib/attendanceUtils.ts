interface Participant {
  firstname: string;
  lastname: string;
  isPresent: boolean;
}

/**
 * Filters participants by search term (matches start of first or last name)
 * and sorts them with present participants first.
 */
export function filterAndSortParticipants<T extends Participant>(
  participants: T[],
  searchterm: string
): T[] {
  const s = searchterm.toLowerCase();

  return participants
    .filter(
      (p) => p.lastname.toLowerCase().startsWith(s) || p.firstname.toLowerCase().startsWith(s)
    )
    .sort((a, b) => {
      if (a.isPresent && !b.isPresent) return -1;
      if (!a.isPresent && b.isPresent) return 1;
      return 0;
    });
}

/**
 * Calculates attendance statistics from a list of participants.
 */
export function getAttendanceStats<T extends Participant & { trainerRole: string }>(
  participants: T[]
): {
  present: number;
  total: number;
  mainTrainers: number;
  assistants: number;
  hasMainTrainer: boolean;
} {
  const present = participants.filter((p) => p.isPresent);
  const mainTrainers = present.filter((p) => p.trainerRole === 'main_trainer');
  const assistants = present.filter((p) => p.trainerRole === 'assistant');

  return {
    present: present.length,
    total: participants.length,
    mainTrainers: mainTrainers.length,
    assistants: assistants.length,
    hasMainTrainer: mainTrainers.length > 0
  };
}
