import { describe, expect, it } from 'vitest';
import {
  canGrade,
  canManageExams,
  canPlanTrainings,
  homePath,
  isApproved,
  isStaff,
  isWriter
} from './roles';

describe('roles', () => {
  it('sends staff to the dashboard', () => {
    for (const role of ['viewer', 'trainer', 'admin'] as const) {
      expect(isStaff({ status: 'approved', role })).toBe(true);
      expect(homePath({ status: 'approved', role })).toBe('/dashboard');
    }
  });

  it('sends approved members to the club area', () => {
    const profile = { status: 'approved', role: 'member' } as const;
    expect(isApproved(profile)).toBe(true);
    expect(isStaff(profile)).toBe(false);
    expect(homePath(profile)).toBe('/club');
  });

  it('keeps pending, disabled and missing profiles on the pending page', () => {
    expect(homePath({ status: 'pending', role: 'viewer' })).toBe('/pending');
    expect(homePath({ status: 'disabled', role: 'admin' })).toBe('/pending');
    expect(homePath(null)).toBe('/pending');
    expect(isStaff({ status: 'disabled', role: 'admin' })).toBe(false);
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
