import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PROVIDER_EVENT_FIELDS } from '$lib/eventLinks';

const maybeSingle = vi.fn();
const from = vi.fn((table: string) => {
  expect(table).toBe('integration_connections');
  return { select: () => ({ eq: () => ({ maybeSingle }) }) };
});
vi.mock('$lib/supabase', () => ({ supabaseClient: { from: (table: string) => from(table) } }));

const { load } = await import('./+page');

const link = { connection: 'webling', url: null };

async function run(canWrite: boolean, eventLink: typeof link | null) {
  return load({
    parent: async () => ({ canWrite, eventLink }),
    params: { eventId: '61001' }
  } as never) as Promise<{ lockedFields: string[] }>;
}

beforeEach(() => {
  from.mockClear();
  maybeSingle.mockReset();
});

describe('edit event load', () => {
  it('sends viewers back to the event', async () => {
    await expect(run(false, null)).rejects.toMatchObject({
      status: 303,
      location: '/dashboard/events/61001'
    });
    await expect(run(false, link)).rejects.toMatchObject({ status: 303 });
  });

  it('locks nothing on an event of the app', async () => {
    expect(await run(true, null)).toEqual({ lockedFields: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it('opens a linked event to writers, locking what its provider owns or fills', async () => {
    maybeSingle.mockResolvedValue({
      data: { field_policy: { 'event.title': 'owned', 'event.location': 'fill' } },
      error: null
    });
    expect(await run(true, link)).toEqual({ lockedFields: ['title', 'location'] });
    expect(from).toHaveBeenCalledWith('integration_connections');
  });

  it("leaves a Webling event's description to the app from phase 4", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        field_policy: {
          'event.title': 'owned',
          'event.date': 'owned',
          'event.date_to': 'owned',
          'event.all_day': 'owned',
          'event.timeFrom': 'fill',
          'event.timeTo': 'fill',
          'event.location': 'fill',
          'event.maxParticipants': 'fill',
          'event.section': 'owned'
        }
      },
      error: null
    });
    const { lockedFields } = await run(true, link);
    expect(lockedFields).toEqual(PROVIDER_EVENT_FIELDS.filter((f) => f !== 'description'));
    expect(lockedFields).toEqual(expect.arrayContaining(['date_to', 'all_day']));
  });

  it('locks every provider field when the policy cannot be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    maybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST205', message: 'missing' } });
    expect(await run(true, link)).toEqual({ lockedFields: [...PROVIDER_EVENT_FIELDS] });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await run(true, link)).toEqual({ lockedFields: [...PROVIDER_EVENT_FIELDS] });
    log.mockRestore();
  });
});
