import type { Athletes } from '$lib/models';
import { rpcRows } from '$lib/supabase';
import { groupBySection } from '$lib/statsUtils';

export type Rankings = { [section: string]: Athletes[] };

async function grouped(fn: string, args: Record<string, unknown>): Promise<Rankings> {
  const { error, data } = await rpcRows<Athletes>(fn, args);
  if (error) throw new Error(error.message);
  return groupBySection(data);
}

/** Most active trainers per section (main trainer and assistant sessions). */
export function loadTopTrainers(mode: 'YEAR' | 'ALL', year: number) {
  return grouped('get_top_trainers_by_section', { year: mode === 'ALL' ? '' : year });
}

/** Members who took part in the most events per section. */
export function loadTopEventParticipants(mode: 'YEAR' | 'ALL', year: number) {
  return grouped('get_top_event_participants', {
    year_param: mode === 'ALL' ? null : year.toString(),
    section_param: null
  });
}

/** Members who coached at the most events per section. */
export function loadTopEventCoaches(mode: 'YEAR' | 'ALL', year: number) {
  return grouped('get_top_event_coaches', {
    year_param: mode === 'ALL' ? null : year.toString(),
    section_param: null
  });
}
