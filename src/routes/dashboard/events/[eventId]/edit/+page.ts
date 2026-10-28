import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { supabaseClient } from '$lib/supabase';
import { lockedEventFields } from '$lib/eventLinks';

// Viewers may look at an event but not edit it. An event its provider
// maintains stays editable in what the provider leaves to the app (the
// registration deadline); the fields it owns or fills are locked, as the
// database would refuse them.
export const load: PageLoad = async ({ parent, params }) => {
  const { canWrite, eventLink } = await parent();
  if (!canWrite) {
    redirect(303, `/dashboard/events/${params.eventId}`);
  }
  if (!eventLink) {
    return { lockedFields: lockedEventFields(null, null) };
  }
  const { data, error } = await supabaseClient
    .from('integration_connections')
    .select('field_policy')
    .eq('id', eventLink.connection)
    .maybeSingle();
  if (error) {
    // Locks every field a provider may write: nothing the database refuses
    console.error('Error loading the provider field policy:', error);
  }
  return { lockedFields: lockedEventFields(eventLink, error ? null : data?.field_policy) };
};
