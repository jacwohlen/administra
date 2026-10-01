import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Viewers may look at an event but not edit it
export const load: PageLoad = async ({ parent, params }) => {
  const { canWrite } = await parent();
  if (!canWrite) {
    redirect(303, `/dashboard/events/${params.eventId}`);
  }
};
