import { supabaseClient } from '$lib/supabase';
import dayjs from 'dayjs';
import type { EventOption } from './ExamForm.svelte';

/** Events an exam day can be linked to: upcoming ones plus the currently linked one. */
export async function loadEventOptions(linkedId?: number | null): Promise<EventOption[]> {
  const today = dayjs().format('YYYY-MM-DD');
  const filter = linkedId ? `date.gte.${today},id.eq.${linkedId}` : `date.gte.${today}`;
  const { data } = await supabaseClient
    .from('events')
    .select('id, title, date, section, location, registrationDeadline')
    .or(filter)
    .order('date', { ascending: true })
    .limit(100);
  return (data ?? []) as EventOption[];
}
