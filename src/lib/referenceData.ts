import { supabaseClient } from '$lib/supabase';
import type { BadgeDefinition, GradeDefinition } from '$lib/models';

// Badge and grade definitions rarely change (badges only through migrations,
// grade ladders when an admin edits them), so fetch them once per app session
// instead of on every member page visit. Failed fetches are not cached, so
// the next navigation retries.
function cached<T>(table: string): { get: () => Promise<T[]>; invalidate: () => void } {
  let cache: T[] | null = null;
  return {
    get: async () => {
      if (cache) return cache;
      const { data } = await supabaseClient.from(table).select('*');
      if (Array.isArray(data)) {
        cache = data as T[];
        return cache;
      }
      return [];
    },
    invalidate: () => {
      cache = null;
    }
  };
}

const badgeDefinitions = cached<BadgeDefinition>('badge_definitions');
const gradeDefinitions = cached<GradeDefinition>('grade_definitions');

export const getBadgeDefinitions = badgeDefinitions.get;
export const getGradeDefinitions = gradeDefinitions.get;
/** After editing a grade ladder, so the next page load fetches the new one. */
export const invalidateGradeDefinitions = gradeDefinitions.invalidate;
