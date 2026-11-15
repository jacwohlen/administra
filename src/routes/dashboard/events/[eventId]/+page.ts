import { supabaseClient } from '#lib/supabase.ts';
import { error as err } from '@sveltejs/kit';
import type { EventLog, EventParticipantRow, MemberMedal } from '#lib/models.ts';

export async function load({ params, parent }) {
  // None of these needs the event: asked while the layouts still load
  const [
    { event },
    { error: participantsError, data: participantsData },
    { error: logsError, data: logsData },
    { data: medalsData }
  ] = await Promise.all([
    parent(),
    // Event participants with member details
    supabaseClient
      .from('event_participants')
      .select(
        `
      *,
      members:memberId (
        id,
        firstname,
        lastname,
        labels,
        img
      )
    `
      )
      .eq('eventId', params.eventId),
    // Event logs (attendance records)
    supabaseClient
      .from('event_logs')
      .select(
        `
      *,
      members:memberId (
        id,
        firstname,
        lastname
      )
    `
      )
      .eq('eventId', params.eventId),
    // Medals recorded for this event (tournament placements)
    supabaseClient.from('member_medals').select('*').eq('eventId', params.eventId)
  ]);

  if (participantsError) {
    throw err(404, participantsError.message);
  }
  if (logsError) {
    throw err(404, logsError.message);
  }

  return {
    event,
    // Each registration carries its member (name, photo): the add box searches
    // the members itself, so the page loads no member list
    participants: (participantsData as unknown as EventParticipantRow[]) || [],
    logs: (logsData as EventLog[]) || [],
    medals: (medalsData as MemberMedal[]) || []
  };
}
