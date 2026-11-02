import { supabaseClient } from '#lib/supabase.ts';
import { error as err } from '@sveltejs/kit';
import type { Event } from '#lib/models.ts';
import { eventLinkFromResult } from '#lib/eventLinks.ts';

export async function load({ params }) {
  const [{ error, data }, linkResult] = await Promise.all([
    supabaseClient.from('events').select('*').eq('id', params.eventId).single(),
    // The provider an event comes from owns its fields as long as it still
    // has the event (no gone_at); the edit page sends such events back here
    supabaseClient
      .from('event_links')
      .select('connection, url')
      .eq('event_id', params.eventId)
      .is('gone_at', null)
      .limit(1)
  ]);

  if (error) {
    throw err(404, error.message);
  }

  return {
    event: data as Event,
    eventLink: eventLinkFromResult(linkResult)
  };
}
