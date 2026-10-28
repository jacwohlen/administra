import { describe, it, expect, vi, afterEach } from 'vitest';
import { canChangeEvent, eventLinkFromResult, isMissingSchemaError } from './eventLinks';

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

describe('canChangeEvent', () => {
  const link = { connection: 'webling', url: null };

  it('lets writers change events no provider maintains', () => {
    expect(canChangeEvent(true, null)).toBe(true);
    expect(canChangeEvent(true, undefined)).toBe(true);
  });

  it('keeps everyone from changing a linked event', () => {
    expect(canChangeEvent(true, link)).toBe(false);
    expect(canChangeEvent(false, link)).toBe(false);
  });

  it('keeps viewers from changing any event', () => {
    expect(canChangeEvent(false, null)).toBe(false);
  });
});
