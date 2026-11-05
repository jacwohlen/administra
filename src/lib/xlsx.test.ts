import { describe, expect, it } from 'vitest';
import { buildXlsx, columnName, crc32, sheetName } from './xlsx';

describe('xlsx', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('computes the ZIP checksum', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('cleans tab names', () => {
    expect(sheetName('a/b:c')).toBe('a b c');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(sheetName('')).toBe('Sheet1');
  });

  it('writes a ZIP with text as inline strings, never formulas', () => {
    const bytes = buildXlsx({ name: 'Test', rows: [['=SUM(A1)', 3, '<Müller & Co>']] });
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t>');
    expect(text).not.toContain('<f>');
    expect(text).toContain('<c r="B1"><v>3</v></c>');
    expect(text).toContain('&lt;Müller &amp; Co&gt;');
  });
});
