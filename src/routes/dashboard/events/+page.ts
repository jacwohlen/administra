import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { Event } from '$lib/models';

export async function load() {
  const { error, data } = await supabaseClient
    .from('events')
    .select('*')
    .order('date', { ascending: true })
    .returns<Event[]>();
  if (error) {
    throw err(404, error);
  }

  return {
    events: data
  };
}
