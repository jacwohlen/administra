import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PROVIDER_EVENT_FIELDS,
  canDeleteEvent,
  eventLinkFromResult,
  isMissingSchemaError,
  lockedEventFields
} from './eventLinks';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isMissingSchemaError', () => {
  it('knows a missing table or column (database without the integration layer)', () => {
    expect(
      isMissingSchemaError({
        code: 'PGRST205',
        message: "Could not find the table 'public.event_links'"
      })
    ).toBe(true);
    expect(isMissingSchemaError({ code: 'PGRST204' })).toBe(true);
    expect(isMissingSchemaError({ code: '42P01' })).toBe(true);
    expect(isMissingSchemaError({ code: '42703' })).toBe(true);
  });

  it('is false for other errors and non-errors', () => {
    expect(isMissingSchemaError({ code: '42501' })).toBe(false);
    expect(isMissingSchemaError({ message: 'Failed to fetch' })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
  });
});

describe('eventLinkFromResult', () => {
  it('reads the live link of a list query', () => {
    expect(
      eventLinkFromResult({
        data: [
          { connection: 'webling', url: 'https://club.webling.ch/portal#/calendar/event/51830' }
        ],
        error: null
      })
    ).toEqual({
      connection: 'webling',
      url: 'https://club.webling.ch/portal#/calendar/event/51830'
    });
  });

  it('reads a single row too', () => {
    expect(eventLinkFromResult({ data: { connection: 'csv', url: null }, error: null })).toEqual({
      connection: 'csv',
      url: null
    });
  });

  it('is null for an event without a live link', () => {
    expect(eventLinkFromResult({ data: [], error: null })).toBeNull();
    expect(eventLinkFromResult({ data: null, error: null })).toBeNull();
    expect(eventLinkFromResult({ data: [{ connection: '' }], error: null })).toBeNull();
  });

  it('is null, quietly, on a database without event_links', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      eventLinkFromResult({ data: null, error: { code: 'PGRST205', message: 'not found' } })
    ).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it('is null on any other error, which is logged', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(eventLinkFromResult({ data: null, error: { message: 'Failed to fetch' } })).toBeNull();
    expect(log).toHaveBeenCalledOnce();
  });

  it('only keeps https links', () => {
    for (const url of ['javascript:alert(1)', 'http://club.webling.ch/', '', 42]) {
      expect(eventLinkFromResult({ data: [{ connection: 'webling', url }], error: null })).toEqual({
        connection: 'webling',
        url: null
      });
    }
  });
});

describe('canDeleteEvent', () => {
  const link = { connection: 'webling', url: null };

  it('lets writers delete events no provider maintains', () => {
    expect(canDeleteEvent(true, null)).toBe(true);
    expect(canDeleteEvent(true, undefined)).toBe(true);
  });

  it('keeps everyone from deleting a linked event', () => {
    expect(canDeleteEvent(true, link)).toBe(false);
    expect(canDeleteEvent(false, link)).toBe(false);
  });

  it('keeps viewers from deleting any event', () => {
    expect(canDeleteEvent(false, null)).toBe(false);
  });
});

describe('lockedEventFields', () => {
  const link = { connection: 'webling', url: null };
  // as seeded for Webling in the integration layer migration
  const webling = {
    'member.firstname': 'owned',
    'event.title': 'owned',
    'event.date': 'owned',
    'event.date_to': 'owned',
    'event.timeFrom': 'fill',
    'event.timeTo': 'fill',
    'event.location': 'fill',
    'event.maxParticipants': 'fill',
    'event.section': 'owned',
    'event.description': 'owned',
    'break.title': 'owned'
  };

  it('locks nothing on an event no provider maintains', () => {
    expect(lockedEventFields(null, webling)).toEqual([]);
    expect(lockedEventFields(undefined, null)).toEqual([]);
  });

  it('locks what the provider owns or fills, never the registration deadline', () => {
    const locked = lockedEventFields(link, webling);
    expect(locked).toEqual([...PROVIDER_EVENT_FIELDS]);
    expect(locked).not.toContain('registrationDeadline');
  });

  it('leaves the app what the policy does not give the provider', () => {
    expect(
      lockedEventFields(link, {
        'event.title': 'owned',
        'event.location': 'initial',
        'event.date': 'fill'
      })
    ).toEqual(['title', 'date']);
    expect(lockedEventFields(link, {})).toEqual([]);
  });

  it('locks every field a provider may write when the policy is unknown', () => {
    for (const policy of [null, undefined, 'owned', ['event.title'], 42]) {
      expect(lockedEventFields(link, policy)).toEqual([...PROVIDER_EVENT_FIELDS]);
    }
  });
});
