export const ssr = false;
import { redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { loadIntegrationConfig } from '$lib/integrationConfigLoad';
import { needsAttention, parseConnectionStatuses } from '$lib/integrations';
import {
  canGrade,
  canManageExams,
  canPlanTrainings,
  homePath,
  isAdmin,
  isStaff,
  isWriter
} from '$lib/roles';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent, depends }) => {
  const { session, userProfile, access } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  if (!userProfile || !isStaff(userProfile)) {
    redirect(303, homePath(userProfile, access));
  }

  depends('users:pending');
  depends('integrations:status');
  let pendingUsers = 0;
  let integrationAlert = false;
  // Which labels are no chips, trainer groups, provider names: once per
  // session, before a page renders (never fails: the built-in rules apply)
  const config = loadIntegrationConfig();
  if (isAdmin(userProfile)) {
    const [pending, status] = await Promise.all([
      supabaseClient
        .from('user_profiles')
        .select('user_id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      // The avatar's warning dot. Any error means no dot: the
      // Integrations page tells the rest
      supabaseClient.rpc('integration_status')
    ]);
    pendingUsers = pending.count ?? 0;
    integrationAlert = !status.error && needsAttention(parseConnectionStatuses(status.data));
  }
  await config;

  return {
    session,
    userProfile,
    pendingUsers,
    // Admins: a sync run refused or failed, no success for 36 hours, open errors,
    // or new groups or calendars to review
    integrationAlert,
    // Viewers browse read-only; pages hide their add/edit/delete controls
    canWrite: isWriter(userProfile),
    // User management, merging duplicate members
    isAdmin: isAdmin(userProfile),
    // Q-Prüfungen: the TK runs exam days and programs, examiners score
    canManageExams: canManageExams(userProfile),
    canGrade: canGrade(userProfile),
    // Trainingsplanung: the TK plans trainers and topics
    canPlanTrainings: canPlanTrainings(userProfile)
  };
};
