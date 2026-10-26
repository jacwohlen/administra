/**
 * One cell of a CSV download. Quotes values with a comma, quote or line
 * break, and puts an apostrophe in front of a value starting with = + - @
 * (or a tab / carriage return), which Excel would otherwise run as a
 * formula — names in the exports are typed by staff or read by the
 * Daten-Assistent and must never execute.
 */
export function csvCell(value: unknown): string {
  let cell = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) cell = `'${cell}`;
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
