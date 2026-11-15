import { describe, expect, it } from 'vitest';
import { buildPdf, pdfString, textWidth, wrapText } from './pdf';

const decode = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('pdf', () => {
  it('writes WinAnsi strings: umlauts as octal, brackets escaped, unknown as ?', () => {
    expect(pdfString('Müller (Jg. 2010)')).toBe('(M\\374ller \\(Jg. 2010\\))');
    expect(pdfString('a\\b – 5 €')).toBe('(a\\\\b \\226 5 \\200)');
    expect(pdfString('柔道')).toBe('(??)');
  });

  it('measures and wraps text', () => {
    expect(textWidth('0000', 10)).toBeCloseTo(22.24);
    expect(textWidth('ä', 10)).toBe(textWidth('a', 10));
    expect(wrapText('Muster Anna, Beispiel Ben, Zeller Cleo', 60, 9)).toEqual([
      'Muster Anna,',
      'Beispiel Ben,',
      'Zeller Cleo'
    ]);
    expect(wrapText('', 60, 9)).toEqual(['']);
    expect(wrapText('x'.repeat(40), 30, 9).every((l) => textWidth(l, 9) <= 30)).toBe(true);
  });

  it('breaks long tables onto pages with a valid cross-reference table', () => {
    const rows = Array.from({ length: 150 }, (_, i) => [`Person ${i}`, String(i)]);
    const bytes = buildPdf({
      title: 'Test',
      pageLabel: (p, n) => `Seite ${p} von ${n}`,
      tables: [
        {
          heading: 'Tabelle',
          columns: [
            { label: 'Name', width: 300 },
            { label: 'Zahl', width: 100, align: 'right' }
          ],
          rows
        }
      ]
    });
    const text = decode(bytes);
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`Seite ${pages} von ${pages}`);
    // Every xref entry points at its object
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text
      .slice(xref)
      .split('\n')
      .slice(3, 3 + 4 + 2 * pages);
    entries.forEach((e, i) => {
      const offset = Number(e.slice(0, 10));
      expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
    // Stream lengths are exact
    for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = m.index! + m[0].length;
      expect(text.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe('\nendstream');
    }
  });
});
