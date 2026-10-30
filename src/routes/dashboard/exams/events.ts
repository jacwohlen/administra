import { supabaseClient } from '$lib/supabase';
import dayjs from 'dayjs';
import { endsOnOrAfter } from '$lib/eventUtils';
import type { EventOption } from './ExamForm.svelte';

/**
 * Events an exam day can be linked to: those not over yet (a multi-day
 * event up to its last day) plus the currently linked one.
 */
export async function loadEventOptions(linkedId?: number | null): Promise<EventOption[]> {
  const today = dayjs().format('YYYY-MM-DD');
  const notOver = endsOnOrAfter(today);
  const filter = linkedId ? `${notOver},id.eq.${linkedId}` : notOver;
  const { data } = await supabaseClient
    .from('events')
    .select('id, title, date, section, location, registrationDeadline')
    .or(filter)
    .order('date', { ascending: true })
    .limit(100);
  return (data ?? []) as EventOption[];
}
