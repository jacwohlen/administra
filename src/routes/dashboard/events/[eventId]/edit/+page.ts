import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { canChangeEvent } from '$lib/eventLinks';

// Viewers may look at an event but not edit it, and nobody edits an event
// its provider maintains (the database would refuse the save)
export const load: PageLoad = async ({ parent, params }) => {
  const { canWrite, eventLink } = await parent();
  if (!canChangeEvent(canWrite, eventLink)) {
    redirect(303, `/dashboard/events/${params.eventId}`);
  }
};
