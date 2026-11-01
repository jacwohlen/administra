export const ssr = false;
import { redirect } from '@sveltejs/kit';
import { isModuleEnabled } from '$lib/integrationConfig';
import { loadIntegrationConfig } from '$lib/integrationConfigLoad';
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

export const load: LayoutLoad = async ({ data, parent }) => {
  const { session, userProfile, access } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  if (!userProfile || !isStaff(userProfile)) {
    redirect(303, homePath(userProfile, access));
  }

  // Which labels are no chips, trainer groups, provider names: once per
  // session, before a page renders (never fails: the built-in rules apply).
  // The admin's badges come from +layout.server.ts.
  await loadIntegrationConfig();

  return {
    session,
    userProfile,
    pendingUsers: data.pendingUsers,
    integrationAlert: data.integrationAlert,
    // Viewers browse read-only; pages hide their add/edit/delete controls
    canWrite: isWriter(userProfile),
    // User management, merging duplicate members
    isAdmin: isAdmin(userProfile),
    // Q-Prüfungen: the TK runs exam days and programs, examiners score
    canManageExams: canManageExams(userProfile),
    canGrade: canGrade(userProfile),
    // Trainingsplanung: the TK plans trainers and topics
    canPlanTrainings: canPlanTrainings(userProfile),
    // Optional modules, switched on the Integrations page; J+S is for
    // trainers and admins only (RLS: is_writer())
    jsEnabled: isWriter(userProfile) && isModuleEnabled('js')
  };
};
