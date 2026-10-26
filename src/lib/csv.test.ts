import { describe, expect, it } from 'vitest';
import { csvCell } from './csv';

describe('csvCell', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('Muster, Hans')).toBe('"Muster, Hans"');
    expect(csvCell('Der "Chef"')).toBe('"Der ""Chef"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('defuses formulas but keeps numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
  });
});
