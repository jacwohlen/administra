import { supabaseClient } from '$lib/supabase';
import type { BadgeDefinition, GradeDefinition } from '$lib/models';

// Badge and grade definitions are static reference data (they only change
// through migrations), so fetch them once per app session instead of on
// every member page visit. Failed fetches are not cached, so the next
// navigation retries.
function cached<T>(table: string): () => Promise<T[]> {
  let cache: T[] | null = null;
  return async () => {
    if (cache) return cache;
    const { data } = await supabaseClient.from(table).select('*');
    if (Array.isArray(data)) {
      cache = data as T[];
      return cache;
    }
    return [];
  };
}

export const getBadgeDefinitions = cached<BadgeDefinition>('badge_definitions');
export const getGradeDefinitions = cached<GradeDefinition>('grade_definitions');
