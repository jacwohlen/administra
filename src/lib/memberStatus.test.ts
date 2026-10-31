import { describe, it, expect } from 'vitest';
import {
  canBeTrainer,
  hasTrainerLabel,
  isCurrentMember,
  isMainTrainerEmailError,
  isManagedByProviderError,
  providerName,
  statusChip,
  visibleLabels
} from './memberStatus';

describe('isCurrentMember', () => {
  it('keeps trial candidates, active and passive members', () => {
    expect(isCurrentMember('trial')).toBe(true);
    expect(isCurrentMember('active')).toBe(true);
    expect(isCurrentMember('passive')).toBe(true);
    expect(isCurrentMember(undefined)).toBe(true);
  });

  it('drops non-members and people who left', () => {
    expect(isCurrentMember('non_member')).toBe(false);
    expect(isCurrentMember('left')).toBe(false);
  });
});

describe('canBeTrainer', () => {
  it('allows active and passive members only', () => {
    expect(canBeTrainer('active')).toBe(true);
    expect(canBeTrainer('passive')).toBe(true);
    expect(canBeTrainer('trial')).toBe(false);
    expect(canBeTrainer('non_member')).toBe(false);
    expect(canBeTrainer('left')).toBe(false);
  });
});

describe('visibleLabels', () => {
  it('keeps roles and groups', () => {
    expect(visibleLabels(['Aktiv', 'Erwachsenentrainer', 'J&S', 'Vorstand'])).toEqual([
      'Erwachsenentrainer',
      'J&S',
      'Vorstand'
    ]);
  });

  it('hides status groups and Webling bookkeeping', () => {
    expect(
      visibleLabels([
        'Passiv',
        'Ehrenmitglieder',
        'Nicht-Mitglieder',
        'Probetraining',
        'probetraining',
        '03_Austritt',
        '02_Rechnung verschickt',
        '01_Anmeldung',
        'Test',
        'new'
      ])
    ).toEqual([]);
  });

  it('keeps labels staff typed, which are lowercase', () => {
    expect(visibleLabels(['passiv', 'nicht-mitglieder', '03_austritt', 'test'])).toEqual([
      'passiv',
      'nicht-mitglieder',
      '03_austritt',
      'test'
    ]);
  });

  it('copes with missing labels', () => {
    expect(visibleLabels(null)).toEqual([]);
    expect(visibleLabels(undefined)).toEqual([]);
  });
});

describe('hasTrainerLabel (built-in rule)', () => {
  it('knows Webling adult trainers, in any case', () => {
    expect(hasTrainerLabel(['Aktiv', 'Erwachsenentrainer'])).toBe(true);
    expect(hasTrainerLabel(['erwachsenentrainer'])).toBe(true);
    expect(hasTrainerLabel(['Kindertrainer', 'Vorstand'])).toBe(false);
    expect(hasTrainerLabel(null)).toBe(false);
  });
});

describe('statusChip', () => {
  it('shows every status except active', () => {
    expect(statusChip('active')).toBeNull();
    expect(statusChip(undefined)).toBeNull();
    expect(statusChip('trial')).toBe('trial');
    expect(statusChip('non_member')).toBe('non_member');
    expect(statusChip('left')).toBe('left');
  });
});

describe('providerName', () => {
  it('names known providers', () => {
    expect(providerName('webling')).toBe('Webling');
    expect(providerName('other')).toBe('other');
  });
});

describe('isManagedByProviderError', () => {
  it('recognises the guard trigger error', () => {
    expect(
      isManagedByProviderError({
        message: 'MANAGED_BY_PROVIDER: member 3295 is maintained in its provider (Webling)'
      })
    ).toBe(true);
    expect(isManagedByProviderError({ message: 'other' })).toBe(false);
    expect(isManagedByProviderError(null)).toBe(false);
  });
});

describe('isMainTrainerEmailError', () => {
  it('recognises the main trainer e-mail guard error', () => {
    expect(
      isMainTrainerEmailError({
        code: '42501',
        message: 'only the TK changes the e-mail of a main trainer'
      })
    ).toBe(true);
    expect(isMainTrainerEmailError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(
      isMainTrainerEmailError({ message: 'only the TK sets the main trainer of a training' })
    ).toBe(false);
    expect(isMainTrainerEmailError(null)).toBe(false);
  });
});
