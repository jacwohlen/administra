import type { UserProfile, UserRole } from './models';

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

/** Where a signed-in account belongs: dashboard for staff, club area for members. */
export function homePath(profile: ProfileAccess): '/dashboard' | '/club' | '/pending' {
  if (isStaff(profile)) return '/dashboard';
  if (isApproved(profile)) return '/club';
  return '/pending';
}
