import { describe, expect, it } from 'vitest';
import { homePath, isApproved, isStaff, isWriter } from './roles';

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
});
