import { describe, expect, it } from 'vitest';
import type { UserRole, UserStatus } from './models';
import {
  canGrade,
  canManageExams,
  canPlanTrainings,
  canUseClub,
  followsMembership,
  homePath,
  isApproved,
  isStaff,
  isWriter
} from './roles';

describe('roles', () => {
  const withAccess = { has_access: true };
  const withoutAccess = { has_access: false };

  it('sends staff to the dashboard, whatever their member records say', () => {
    for (const role of ['viewer', 'trainer', 'admin'] as const) {
      expect(isStaff({ status: 'approved', role })).toBe(true);
      expect(homePath({ status: 'approved', role }, null)).toBe('/dashboard');
      expect(homePath({ status: 'approved', role }, withoutAccess)).toBe('/dashboard');
    }
  });

  it('sends approved members to the club area while a membership counts', () => {
    const profile = { status: 'approved', role: 'member' } as const;
    expect(isApproved(profile)).toBe(true);
    expect(isStaff(profile)).toBe(false);
    expect(canUseClub(profile, withAccess)).toBe(true);
    expect(homePath(profile, withAccess)).toBe('/club');
  });

  it('keeps approved members without an active or passive membership out', () => {
    const profile = { status: 'approved', role: 'member' } as const;
    expect(canUseClub(profile, withoutAccess)).toBe(false);
    expect(homePath(profile, withoutAccess)).toBe('/pending');
  });

  it('routes by the status when access is unknown (call failed, not migrated yet)', () => {
    const profile = { status: 'approved', role: 'member' } as const;
    expect(homePath(profile, null)).toBe('/club');
    expect(homePath(profile, undefined)).toBe('/club');
  });

  it('keeps pending, disabled and missing profiles on the pending page', () => {
    expect(homePath({ status: 'pending', role: 'member' }, withoutAccess)).toBe('/pending');
    // A record that counts does not skip the approval
    expect(homePath({ status: 'pending', role: 'member' }, withAccess)).toBe('/pending');
    expect(homePath({ status: 'pending', role: 'viewer' }, null)).toBe('/pending');
    expect(homePath({ status: 'disabled', role: 'admin' }, null)).toBe('/pending');
    expect(homePath({ status: 'disabled', role: 'member' }, withAccess)).toBe('/pending');
    expect(homePath(null, null)).toBe('/pending');
    expect(isStaff({ status: 'disabled', role: 'admin' })).toBe(false);
  });

  it('asks for the membership only where it decides', () => {
    expect(followsMembership({ status: 'approved', role: 'member' })).toBe(true);
    expect(followsMembership({ status: 'pending', role: 'member' })).toBe(true);
    expect(followsMembership({ status: 'pending', role: 'trainer' })).toBe(true);
    expect(followsMembership({ status: 'approved', role: 'trainer' })).toBe(false);
    expect(followsMembership({ status: 'disabled', role: 'member' })).toBe(false);
    expect(followsMembership(null)).toBe(false);
  });

  it('agrees between the guards, so no page sends an account back and forth', () => {
    const statuses: UserStatus[] = ['pending', 'approved', 'disabled'];
    const roles: UserRole[] = ['member', 'viewer', 'trainer', 'admin'];
    const accesses = [withAccess, withoutAccess, null, undefined];
    for (const status of statuses)
      for (const role of roles)
        for (const access of accesses) {
          const profile = { status, role };
          const home = homePath(profile, access);
          // /dashboard lets in exactly isStaff, /club exactly canUseClub, /pending the rest
          expect(home === '/dashboard').toBe(isStaff(profile));
          expect(home !== '/pending').toBe(canUseClub(profile, access));
        }
  });

  it('lets only approved trainers and admins write', () => {
    expect(isWriter({ status: 'approved', role: 'trainer' })).toBe(true);
    expect(isWriter({ status: 'approved', role: 'admin' })).toBe(true);
    expect(isWriter({ status: 'approved', role: 'viewer' })).toBe(false);
    expect(isWriter({ status: 'approved', role: 'member' })).toBe(false);
    expect(isWriter({ status: 'pending', role: 'admin' })).toBe(false);
    expect(isWriter(null)).toBe(false);
  });

  it('gives exam roles to staff only, and everything to admins', () => {
    const admin = { status: 'approved', role: 'admin', exam_role: null } as const;
    expect(canManageExams(admin)).toBe(true);
    expect(canGrade(admin)).toBe(true);

    const trainer = { status: 'approved', role: 'trainer' } as const;
    expect(canManageExams(trainer)).toBe(false);
    expect(canGrade(trainer)).toBe(false);

    const examiner = { status: 'approved', role: 'viewer', exam_role: 'examiner' } as const;
    expect(canManageExams(examiner)).toBe(false);
    expect(canGrade(examiner)).toBe(true);

    const tk = { status: 'approved', role: 'trainer', exam_role: 'manager' } as const;
    expect(canManageExams(tk)).toBe(true);
    expect(canGrade(tk)).toBe(true);

    const member = { status: 'approved', role: 'member', exam_role: 'manager' } as const;
    expect(canManageExams(member)).toBe(false);
    expect(canGrade(member)).toBe(false);

    const pending = { status: 'pending', role: 'trainer', exam_role: 'manager' } as const;
    expect(canManageExams(pending)).toBe(false);
    expect(canGrade(pending)).toBe(false);
    expect(canGrade(null)).toBe(false);
  });

  it('lets the TK and admins plan trainings, but not plain trainers', () => {
    expect(canPlanTrainings({ status: 'approved', role: 'admin', exam_role: null })).toBe(true);
    expect(canPlanTrainings({ status: 'approved', role: 'viewer', exam_role: 'manager' })).toBe(
      true
    );
    expect(canPlanTrainings({ status: 'approved', role: 'trainer', exam_role: null })).toBe(false);
    expect(canPlanTrainings({ status: 'approved', role: 'viewer', exam_role: 'examiner' })).toBe(
      false
    );
  });
});
