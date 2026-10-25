import { describe, expect, it } from 'vitest';
import { AssistantError, parseAssistantRequest } from './request';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const jpeg = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const pdf = Buffer.from('%PDF-1.7 fake').toString('base64').padEnd(20, '=');

function code(body: unknown): string | null {
  try {
    parseAssistantRequest(body);
    return null;
  } catch (e) {
    return e instanceof AssistantError ? `${e.status} ${e.code}` : 'other';
  }
}

describe('parseAssistantRequest', () => {
  it('accepts an image with its context', () => {
    const request = parseAssistantRequest({
      kind: 'attendance',
      files: [{ name: 'liste.jpg', mediaType: 'image/jpeg', data: jpeg }],
      locale: 'en',
      context: { trainingId: 28, date: '2026-10-26', memberId: 'x' }
    });
    expect(request.kind).toBe('attendance');
    expect(request.files).toHaveLength(1);
    expect(request.locale).toBe('en');
    expect(request.context).toEqual({ trainingId: 28, date: '2026-10-26', memberId: undefined });
  });

  it('accepts pasted text alone', () => {
    expect(parseAssistantRequest({ kind: 'events', text: 'Kids Cup 14.11.' }).text).toBe(
      'Kids Cup 14.11.'
    );
  });

  it('rejects unknown kinds and empty requests', () => {
    expect(code({ kind: 'members', text: 'x' })).toBe('400 invalid_request');
    expect(code({ kind: 'events' })).toBe('400 invalid_request');
    expect(code({ kind: 'events', text: '   ' })).toBe('400 invalid_request');
    expect(code(null)).toBe('400 invalid_request');
  });

  it('checks the file type by its bytes', () => {
    expect(code({ kind: 'events', files: [{ mediaType: 'image/png', data: jpeg }] })).toBe(
      '400 invalid_request'
    );
    expect(code({ kind: 'events', files: [{ mediaType: 'image/svg+xml', data: jpeg }] })).toBe(
      '400 invalid_request'
    );
    expect(code({ kind: 'events', files: [{ mediaType: 'application/pdf', data: pdf }] })).toBe(
      null
    );
    expect(
      code({ kind: 'events', files: [{ mediaType: 'image/jpeg', data: 'not base64!' }] })
    ).toBe('400 invalid_request');
  });

  it('enforces the limits', () => {
    const file = { mediaType: 'image/jpeg', data: jpeg };
    expect(code({ kind: 'events', files: [file, file, file, file, file] })).toBe('413 too_large');
    const big = { mediaType: 'image/jpeg', data: jpeg + 'A'.repeat(4_800_000) };
    expect(code({ kind: 'events', files: [big] })).toBe('413 too_large');
    expect(code({ kind: 'events', text: 'x'.repeat(30_001) })).toBe('413 too_large');
    expect(code({ kind: 'events', text: 'x', hint: 'x'.repeat(501) })).toBe('413 too_large');
  });

  it('requires the context a kind needs', () => {
    expect(code({ kind: 'attendance', text: 'Lena' })).toBe('400 invalid_request');
    expect(code({ kind: 'lesson_plan', text: 'x', context: { trainingId: 3 } })).toBe(
      '400 invalid_request'
    );
    expect(
      code({ kind: 'lesson_plan', text: 'x', context: { trainingId: 3, date: '2026-02-30' } })
    ).toBe('400 invalid_request');
    expect(
      code({ kind: 'lesson_plan', text: 'x', context: { trainingId: 3, date: '2026-02-03' } })
    ).toBe(null);
  });
});
