import { describe, expect, it } from 'vitest';
import {
  CRLF,
  ZURICH_VTIMEZONE,
  dateValue,
  escapeText,
  foldLine,
  icsFile,
  localDateTime,
  utcDateTime
} from './ics';

const octets = (text: string) => new TextEncoder().encode(text).length;
const unfold = (text: string) => text.replace(/\r\n /g, '');

describe('escapeText', () => {
  it('escapes backslash first, then semicolon, comma and line breaks', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
    // An escaped character is not escaped twice
    expect(escapeText('\\;')).toBe('\\\\\\;');
    expect(escapeText('\\n')).toBe('\\\\n');
  });

  it('drops CR and control characters, keeps colon and tab', () => {
    expect(escapeText('Zeile 1\r\nZeile 2\r')).toBe('Zeile 1\\nZeile 2');
    expect(escapeText('Check-in: https://x.ch/a')).toBe('Check-in: https://x.ch/a');
    expect(escapeText('a\tb\u0000c\u0007d\u007fe')).toBe('a\tbcde');
    expect(escapeText('Fällt aus – 🥋')).toBe('Fällt aus – 🥋');
  });
});

describe('foldLine', () => {
  it('leaves lines of up to 75 octets alone', () => {
    const line = 'SUMMARY:' + 'a'.repeat(67);
    expect(octets(line)).toBe(75);
    expect(foldLine(line)).toEqual([line]);
  });

  it('folds at 75 octets, continuation lines starting with one space', () => {
    const line = 'DESCRIPTION:' + 'x'.repeat(200);
    const lines = foldLine(line);
    expect(lines[0]).toBe(line.slice(0, 75));
    expect(lines.slice(1).every((l) => l.startsWith(' ') && !l.startsWith('  '))).toBe(true);
    expect(lines.every((l) => octets(l) <= 75)).toBe(true);
    expect(lines.slice(0, -1).every((l) => octets(l) === 75)).toBe(true);
    expect(unfold(lines.join(CRLF))).toBe(line);
  });

  it.each([
    ['ä', 2],
    ['–', 3],
    ['🥋', 4]
  ])('never splits %s (%i octets) at the boundary', (char, size) => {
    // Every offset puts the character across the 75th octet once
    for (let fill = 70; fill <= 75; fill++) {
      const line = 'SUMMARY:' + 'a'.repeat(fill - 8) + char + 'b'.repeat(80) + char.repeat(40);
      const lines = foldLine(line);
      for (const l of lines) {
        expect(octets(l)).toBeLessThanOrEqual(75);
        // A cut character would not survive the round trip through UTF-8
        expect(new TextDecoder().decode(new TextEncoder().encode(l))).toBe(l);
        expect(l).not.toMatch(/[\uD800-\uDBFF]$|^ ?[\uDC00-\uDFFF]/);
      }
      expect(octets(lines[0])).toBe(fill + size <= 75 ? 75 : fill);
      expect(unfold(lines.join(CRLF))).toBe(line);
    }
    expect(size).toBe(octets(char));
  });
});

describe('icsFile', () => {
  it('ends every line with CRLF, the last one too', () => {
    const text = icsFile(['BEGIN:VCALENDAR', 'SUMMARY:' + 'ü'.repeat(100), 'END:VCALENDAR']);
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).not.toMatch(/[^\r]\n|\r[^\n]/);
    const physical = text.split(CRLF).slice(0, -1);
    expect(physical.length).toBeGreaterThan(3);
    expect(physical.every((l) => octets(l) <= 75)).toBe(true);
    expect(unfold(text)).toBe(
      ['BEGIN:VCALENDAR', 'SUMMARY:' + 'ü'.repeat(100), 'END:VCALENDAR'].join(CRLF) + CRLF
    );
  });
});

describe('date-times', () => {
  it('formats UTC date-times', () => {
    expect(utcDateTime(new Date('2026-10-28T08:15:09.999Z'))).toBe('20261028T081509Z');
    expect(utcDateTime(new Date('2026-03-29T01:30:00+02:00'))).toBe('20260328T233000Z');
  });

  it('formats local date-times from minutes after midnight', () => {
    expect(localDateTime('2026-11-04', 20 * 60)).toBe('20261104T200000');
    expect(localDateTime('2026-11-04', 18 * 60 + 30)).toBe('20261104T183000');
    expect(localDateTime('2026-11-04', 0)).toBe('20261104T000000');
    // Past midnight: the next day, also over a month and year end
    expect(localDateTime('2026-12-31', 23 * 60 + 90)).toBe('20270101T003000');
    // Wall clock: the night of the DST switch does not shift it
    expect(localDateTime('2026-10-25', 3 * 60)).toBe('20261025T030000');
    expect(localDateTime('2027-03-28', 2 * 60 + 30)).toBe('20270328T023000');
  });

  it('formats dates', () => {
    expect(dateValue('2026-11-04')).toBe('20261104');
    expect(dateValue('2026-12-31', 1)).toBe('20270101');
    expect(dateValue('2028-02-28', 1)).toBe('20280229');
  });
});

describe('ZURICH_VTIMEZONE', () => {
  it('describes CET and CEST with the EU switch rules', () => {
    expect(ZURICH_VTIMEZONE[0]).toBe('BEGIN:VTIMEZONE');
    expect(ZURICH_VTIMEZONE).toContain('TZID:Europe/Zurich');
    expect(ZURICH_VTIMEZONE).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU');
    expect(ZURICH_VTIMEZONE).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU');
    expect(ZURICH_VTIMEZONE.at(-1)).toBe('END:VTIMEZONE');
  });
});
