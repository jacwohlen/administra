import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { Event } from '$lib/models';

export async function load({ params }) {
  const { error, data } = await supabaseClient
    .from('events')
    .select('*')
    .eq('id', params.eventId)
    .single();

  if (error) {
    throw err(404, error);
  }

  return {
    event: data as Event
  };
}
