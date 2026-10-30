import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

// The J+S module is optional: off on the Integrations page, its pages are gone
export const load: LayoutLoad = async ({ parent }) => {
  const { jsEnabled } = await parent();
  if (!jsEnabled) {
    redirect(303, '/dashboard');
  }
};
