import { isAdmin } from '$lib/roles';
import { needsAttention, parseConnectionStatuses } from '$lib/integrations';
import type { LayoutServerLoad } from './$types';

/**
 * The admin's badges on the avatar: pending accounts and the integrations'
 * warning dot. Asked on the server, so they arrive with the root layout's
 * server data (__data.json) instead of one round trip after it: the
 * dashboard layout's universal load could only ask once `parent()` is done
 * (docs/PERFORMANCE.md). RLS still decides what the account sees.
 */
export const load: LayoutServerLoad = async ({ parent, depends, locals: { supabase } }) => {
  depends('users:pending');
  depends('integrations:status');
  const { userProfile } = await parent();
  if (!userProfile || !isAdmin(userProfile)) {
    return { pendingUsers: 0, integrationAlert: false };
  }
  const [pending, status] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    // The avatar's warning dot. Any error means no dot: the Integrations
    // page tells the rest
    supabase.rpc('integration_status')
  ]);
  return {
    pendingUsers: pending.count ?? 0,
    // A sync run refused or failed, no success for 36 hours, open errors,
    // or new groups or calendars to review
    integrationAlert: !status.error && needsAttention(parseConnectionStatuses(status.data))
  };
};
