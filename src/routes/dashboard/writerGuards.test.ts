import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load as newTraining } from './trainings/new/+page';
import { load as editTraining } from './trainings/[trainingId]/edit/+page';
import { load as newEvent } from './events/new/+page';
import { load as editEvent } from './events/[eventId]/edit/+page';

// Create/edit pages send viewers back to the read-only page they came from.
type Load = (event: never) => unknown;

function event(canWrite: boolean, params: Record<string, string> = {}) {
  return { parent: async () => ({ canWrite }), params } as never;
}

async function redirectTarget(load: Load, canWrite: boolean, params?: Record<string, string>) {
  try {
    await load(event(canWrite, params));
    return null;
  } catch (e) {
    if (isRedirect(e)) return e.location;
    throw e;
  }
}

describe('writer-only dashboard pages', () => {
  const cases: [string, Load, Record<string, string>, string][] = [
    ['new training', newTraining as Load, {}, '/dashboard/trainings'],
    ['edit training', editTraining as Load, { trainingId: '3' }, '/dashboard/trainings/3'],
    ['new event', newEvent as Load, {}, '/dashboard/events'],
    ['edit event', editEvent as Load, { eventId: '5' }, '/dashboard/events/5']
  ];

  for (const [name, load, params, target] of cases) {
    it(`${name}: redirects viewers to ${target}`, async () => {
      expect(await redirectTarget(load, false, params)).toBe(target);
    });

    it(`${name}: lets trainers and admins in`, async () => {
      expect(await redirectTarget(load, true, params)).toBeNull();
    });
  }
});
