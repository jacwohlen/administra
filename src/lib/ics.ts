/**
 * Helpers for iCalendar files (RFC 5545), as served by the training plan's
 * calendar feeds (src/lib/calendarFeed.ts).
 *
 * Pure, without SvelteKit or Supabase imports. Clients are strict about the
 * details: CRLF after every line (the last one too), lines of at most 75
 * octets in UTF-8 and TEXT values escaped.
 */

/** RFC 5545 line break, after every content line */
export const CRLF = '\r\n';

const MAX_OCTETS = 75;

/**
 * Europe/Zurich as a VTIMEZONE, so DTSTART;TZID=Europe/Zurich carries the
 * plan's local times unconverted (rules as on tzurl.org: CEST from the last
 * Sunday in March, CET from the last Sunday in October).
 */
export const ZURICH_TZID = 'Europe/Zurich';
export const ZURICH_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${ZURICH_TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
];

// Control characters but tab and line feed (CR included): not allowed in TEXT
const CONTROL = /[^\P{Cc}\t\n]/gu;

/**
 * A TEXT value: backslash first, then ";", "," and line breaks; CR and
 * other control characters but the tab are dropped. A colon stays as it is.
 */
export function escapeText(value: string): string {
  return value
    .replace(CONTROL, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Bytes of a character (one code point) in UTF-8 */
function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * Folds a content line into lines of at most 75 octets (UTF-8), never
 * inside a character; each continuation line starts with one space, which
 * counts towards its 75. Returns the lines without line breaks.
 */
export function foldLine(line: string): string[] {
  const lines: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = utf8Length(char);
    if (octets + size > MAX_OCTETS) {
      lines.push(current);
      current = ' ';
      octets = 1;
    }
    current += char;
    octets += size;
  }
  lines.push(current);
  return lines;
}

/** The content lines as a file: folded, each one ending in CRLF */
export function icsFile(lines: string[]): string {
  return lines.flatMap(foldLine).join(CRLF) + CRLF;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A UTC date-time: YYYYMMDDTHHMMSSZ */
export function utcDateTime(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * A local date-time (for TZID=...): YYYYMMDDTHHMMSS, `minutes` after the
 * start of `date` (YYYY-MM-DD); 1440 and more fall on the next day. Wall
 * clock arithmetic: a DST switch does not shift it.
 */
export function localDateTime(date: string, minutes: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  return utcDateTime(t).slice(0, -1);
}

/** A DATE value: YYYYMMDD, `days` after `date` (YYYY-MM-DD) */
export function dateValue(date: string, days = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  return utcDateTime(new Date(Date.UTC(y, m - 1, d + days))).slice(0, 8);
}
