/**
 * Manages a list of labels with add/remove/dedup logic.
 */
export function addLabel(labels: string[], input: string): { labels: string[]; input: string } {
  const value = input.trim().toLowerCase();
  if (value && !labels.includes(value)) {
    return { labels: [...labels, value], input: '' };
  }
  return { labels, input: '' };
}

export function removeLabel(labels: string[], label: string): string[] {
  return labels.filter((l) => l !== label);
}

/**
 * Validates whether a member form can be submitted.
 */
export function canSubmitMemberForm(
  firstname: string,
  lastname: string,
  isSubmitting: boolean
): boolean {
  return !!firstname && !!lastname && !isSubmitting;
}
