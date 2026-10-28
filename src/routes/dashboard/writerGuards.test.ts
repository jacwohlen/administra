import { describe, it, expect, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { PROVIDER_EVENT_FIELDS } from '$lib/eventLinks';

// The edit training page loads its main trainer options; every query comes
// back empty here.
vi.mock('$lib/supabase', () => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      }
      return () => new Proxy({}, handler);
    }
  };
  return { supabaseClient: new Proxy({}, handler) };
});
import { load as newTraining } from './trainings/new/+page';
import { load as editTraining } from './trainings/[trainingId]/edit/+page';
import { load as newEvent } from './events/new/+page';
import { load as editEvent } from './events/[eventId]/edit/+page';
import { load as newExam } from './exams/new/+page';
import { load as editExam } from './exams/[examId]/edit/+page';
import { load as trainingPlanSettings } from './training-plan/settings/+page';
import { load as assistant } from './assistant/+page';

// Create/edit pages send viewers back to the read-only page they came from;
// exam days and the training plan settings need the TK (canManageExams /
// canPlanTrainings, the same role), not just a trainer.
type Load = (event: never) => unknown;
type Flags = { canWrite: boolean; canManageExams: boolean };

function event(flags: Flags, params: Record<string, string> = {}) {
  return {
    parent: async () => ({
      ...flags,
      canPlanTrainings: flags.canManageExams,
      exam: { id: 7, event_id: null }
    }),
    params,
    depends: () => {}
  } as never;
}

async function redirectTarget(load: Load, flags: Flags, params?: Record<string, string>) {
  try {
    await load(event(flags, params));
    return null;
  } catch (e) {
    if (isRedirect(e)) return e.location;
    throw e;
  }
}

const viewer = { canWrite: false, canManageExams: false };
const trainer = { canWrite: true, canManageExams: false };
const tk = { canWrite: false, canManageExams: true };

describe('writer-only dashboard pages', () => {
  const cases: [string, Load, Record<string, string>, string][] = [
    ['new training', newTraining as Load, {}, '/dashboard/trainings'],
    ['edit training', editTraining as Load, { trainingId: '3' }, '/dashboard/trainings/3'],
    ['new event', newEvent as Load, {}, '/dashboard/events'],
    ['edit event', editEvent as Load, { eventId: '5' }, '/dashboard/events/5']
  ];

  for (const [name, load, params, target] of cases) {
    it(`${name}: redirects viewers to ${target}`, async () => {
      expect(await redirectTarget(load, viewer, params)).toBe(target);
    });

    it(`${name}: lets trainers and admins in`, async () => {
      expect(await redirectTarget(load, trainer, params)).toBeNull();
    });
  }
});

describe('events a provider maintains', () => {
  const linked = (flags: Flags) =>
    ({
      parent: async () => ({ ...flags, eventLink: { connection: 'webling', url: null } }),
      params: { eventId: '51830' },
      depends: () => {}
    }) as never;

  it('edit event: still sends viewers back to the event', async () => {
    try {
      await (editEvent as Load)(linked(viewer));
      expect.unreachable('a viewer must not open the edit page');
    } catch (e) {
      expect(isRedirect(e) && e.location).toBe('/dashboard/events/51830');
    }
  });

  it('edit event: lets trainers and admins in for the registration deadline, the rest locked', async () => {
    // no policy readable here: every field a provider may write is locked
    expect(await (editEvent as Load)(linked(trainer))).toEqual({
      lockedFields: [...PROVIDER_EVENT_FIELDS]
    });
  });
});

describe('TK-only exam pages', () => {
  const cases: [string, Load, Record<string, string>, string][] = [
    ['new exam day', newExam as Load, {}, '/dashboard/exams'],
    ['edit exam day', editExam as Load, { examId: '7' }, '/dashboard/exams/7'],
    ['training plan settings', trainingPlanSettings as Load, {}, '/dashboard/training-plan']
  ];

  for (const [name, load, params, target] of cases) {
    it(`${name}: redirects viewers and trainers to ${target}`, async () => {
      expect(await redirectTarget(load, viewer, params)).toBe(target);
      expect(await redirectTarget(load, trainer, params)).toBe(target);
    });

    it(`${name}: lets the TK and admins in`, async () => {
      expect(await redirectTarget(load, tk, params)).toBeNull();
    });
  }
});

describe('Daten-Assistent overview', () => {
  it('redirects viewers to the dashboard', async () => {
    expect(await redirectTarget(assistant as Load, viewer)).toBe('/dashboard');
  });

  it('lets trainers, admins and the TK in', async () => {
    expect(await redirectTarget(assistant as Load, trainer)).toBeNull();
    expect(await redirectTarget(assistant as Load, tk)).toBeNull();
  });
});
