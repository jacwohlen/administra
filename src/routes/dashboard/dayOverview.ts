import type { Dayjs } from 'dayjs';
import type { Event, Training } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { compareTrainings } from '$lib/trainingUtils';
import { endsOnOrAfter } from '$lib/eventUtils';

export interface DayOverview {
  trainings: Training[];
  events: Event[];
}

/**
 * The dashboard's day: the trainings on its weekday and the events on the
 * day, one-day events of that day and multi-day events under way (first day
 * on or before it, last day on or after it), all-day ones (no time) first.
 * A failed query shows nothing, as before.
 */
export async function loadDayOverview(date: Dayjs): Promise<DayOverview> {
  const day = date.format('YYYY-MM-DD');
  const [trainings, events] = await Promise.all([
    supabaseClient
      .from('trainings')
      .select(`id, title, dateFrom, dateTo, weekday, section`)
      .eq('weekday', date.locale('en').format('dddd'))
      .returns<Training[]>(),
    supabaseClient
      .from('events')
      .select('*')
      .lte('date', day)
      .or(endsOnOrAfter(day))
      .order('timeFrom', { ascending: true, nullsFirst: true })
      .order('date', { ascending: true })
      .returns<Event[]>()
  ]);
  return {
    trainings: [...(trainings.data ?? [])].sort(compareTrainings),
    events: events.data ?? []
  };
}
