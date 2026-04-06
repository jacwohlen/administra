/**
 * Handles keyboard navigation for a list with wrapping.
 * Returns the new selected index, or null if the key wasn't handled.
 */
export function navigateList(
  key: string,
  currentIndex: number,
  listLength: number
): { index: number; handled: boolean } {
  if (listLength === 0) {
    return { index: currentIndex, handled: false };
  }

  switch (key) {
    case 'ArrowDown':
      return {
        index: currentIndex >= listLength - 1 ? 0 : currentIndex + 1,
        handled: true
      };
    case 'ArrowUp':
      if (currentIndex === -1) return { index: currentIndex, handled: false };
      return {
        index: currentIndex <= 0 ? listLength - 1 : currentIndex - 1,
        handled: true
      };
    case 'Enter':
      return { index: currentIndex, handled: currentIndex >= 0 };
    case 'Escape':
      return { index: -1, handled: true };
    default:
      return { index: currentIndex, handled: false };
  }
}

/**
 * Filters members in an event participant list, excluding already-registered ones.
 */
export function filterExistingParticipants<T extends { id: string }>(
  members: T[],
  existingIds: string[]
): T[] {
  return members.filter((m) => !existingIds.includes(m.id));
}
