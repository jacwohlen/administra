import { describe, it, expect } from 'vitest';
import { DEMO_ACCOUNTS, DEMO_ROLES, demoAccountFor } from './demoAccounts';

describe('demoAccountFor', () => {
  it('maps each demo role to its seeded account', () => {
    expect(demoAccountFor('admin')).toEqual({
      email: 'vorstand@demo.alleda.ch',
      password: 'administra-demo'
    });
    expect(demoAccountFor('trainer')?.email).toBe('trainer@demo.alleda.ch');
    expect(demoAccountFor('member')?.email).toBe('mitglied@demo.alleda.ch');
  });

  it('has an account for every role and nothing else', () => {
    expect(Object.keys(DEMO_ACCOUNTS).sort()).toEqual([...DEMO_ROLES].sort());
    for (const role of DEMO_ROLES) expect(demoAccountFor(role)).toBe(DEMO_ACCOUNTS[role]);
  });

  it.each([
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    '',
    'ADMIN',
    ' admin',
    'viewer',
    'examiner'
  ])('returns null for the unknown role %j', (role) => {
    expect(demoAccountFor(role)).toBeNull();
  });

  it.each([null, undefined, 1, {}, ['admin']])('returns null for the non-string %j', (role) => {
    expect(demoAccountFor(role)).toBeNull();
  });

  it('cannot be changed at runtime', () => {
    expect(Object.isFrozen(DEMO_ACCOUNTS)).toBe(true);
    expect(Object.isFrozen(DEMO_ACCOUNTS.admin)).toBe(true);
  });
});
