import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { Event } from '$lib/models';
import { fetchAllRows } from '$lib/assistant/attendance';

export async function load() {
  let events: Event[];
  try {
    // Page by page: PostgREST returns at most 1000 rows, the oldest first
    events = await fetchAllRows<Event>((from, to) =>
      supabaseClient
        .from('events')
        .select('*')
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch (error) {
    throw err(404, (error as { message?: string } | null)?.message ?? 'Events not loaded');
  }

  return {
    events
  };
}
