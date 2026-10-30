import type { MyAccess, UserProfile, UserRole } from './models';

type ProfileAccess = Pick<UserProfile, 'status' | 'role'> | null | undefined;

/** Roles that may use the management dashboard; 'member' only gets the club area. */
export const STAFF_ROLES: readonly UserRole[] = ['viewer', 'trainer', 'admin'];

export function isApproved(profile: ProfileAccess): boolean {
  return profile?.status === 'approved';
}

export function isStaff(profile: ProfileAccess): boolean {
  return isApproved(profile) && STAFF_ROLES.includes(profile!.role);
}

/** Roles that may change club data; mirrors is_writer() in the database. */
export const WRITER_ROLES: readonly UserRole[] = ['trainer', 'admin'];

export function isWriter(profile: ProfileAccess): boolean {
  return isApproved(profile) && WRITER_ROLES.includes(profile!.role);
}

/** User management, merging duplicate members; mirrors is_admin() in the database. */
export function isAdmin(profile: ProfileAccess): boolean {
  return isApproved(profile) && profile!.role === 'admin';
}

type ExamAccess = Pick<UserProfile, 'status' | 'role' | 'exam_role'> | null | undefined;

/** The TK: exam days and programs; mirrors is_exam_manager() in the database. */
export function canManageExams(profile: ExamAccess): boolean {
  return isStaff(profile) && (profile!.role === 'admin' || profile!.exam_role === 'manager');
}

/** The TK also keeps the training plan (training_plan_* policies use is_exam_manager()). */
export const canPlanTrainings = canManageExams;

/** Examiners score on the sheet; mirrors is_examiner() in the database. */
export function canGrade(profile: ExamAccess): boolean {
  return isStaff(profile) && (profile!.role === 'admin' || profile!.exam_role != null);
}

/**
 * my_access() of the signed-in account (root layout); null when not loaded:
 * staff and disabled accounts, or the call failed.
 */
type Access = Pick<MyAccess, 'has_access'> | null | undefined;

/** Accounts whose access follows their membership, so the root layout asks my_access() */
export function followsMembership(profile: ProfileAccess): boolean {
  return (
    profile?.status === 'pending' || (profile?.status === 'approved' && profile.role === 'member')
  );
}

/**
 * May use the club area: staff by their role, a member account only while
 * one of its member records counts (my_access().has_access is
 * is_approved_user(), the check RLS uses). Unknown access falls back to the
 * status: that only routes, the database still refuses every query, and a
 * failed call or the app deployed before the migration sends nobody away.
 */
export function canUseClub(profile: ProfileAccess, access: Access): boolean {
  return isStaff(profile) || (isApproved(profile) && access?.has_access !== false);
}

/**
 * Where a signed-in account belongs: dashboard for staff, club area for
 * members with access, the pending page for everybody else. Every guard
 * routes with this, so no two pages send an account back and forth.
 */
export function homePath(
  profile: ProfileAccess,
  access: Access
): '/dashboard' | '/club' | '/pending' {
  if (isStaff(profile)) return '/dashboard';
  if (canUseClub(profile, access)) return '/club';
  return '/pending';
}
