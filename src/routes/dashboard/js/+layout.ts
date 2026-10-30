import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

// The J+S module is optional and for trainers and admins: switched off on the
// Integrations page, or for viewers, its pages are gone (jsEnabled covers both)
export const load: LayoutLoad = async ({ parent }) => {
  const { jsEnabled } = await parent();
  if (!jsEnabled) {
    redirect(303, '/dashboard');
  }
};
