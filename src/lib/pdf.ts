/**
 * A small PDF writer for table reports, without a library: A4 portrait,
 * the standard fonts Helvetica and Helvetica-Bold (WinAnsi, so German
 * umlauts and the euro sign work; other characters become "?"), tables
 * with a heading row repeated on every page, wrapped cells and page
 * numbers. Text is only ever drawn as text, never interpreted.
 */

export interface PdfColumn {
  label: string;
  /** Width in points; the columns of a table add up to at most 515 */
  width: number;
  align?: 'left' | 'right';
}

export interface PdfTable {
  heading: string;
  /** A line of explanation under the heading */
  note?: string;
  columns: PdfColumn[];
  rows: string[][];
  /** A bold last row (totals) */
  footer?: string[];
}

export interface PdfDocument {
  title: string;
  subtitle?: string;
  /** Small text at the bottom left of every page */
  footer?: string;
  /** "Seite 1 von 3", at the bottom right */
  pageLabel?: (page: number, pages: number) => string;
  tables: PdfTable[];
}

export const PDF_MIME = 'application/pdf';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FONT = 9;
const LINE = 11;
const PAD = 3;

// Advance widths (1/1000 em) of the printable ASCII characters 32..126
// prettier-ignore
const HELVETICA = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584
];
// prettier-ignore
const HELVETICA_BOLD = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584
];

/** Unicode characters of WinAnsiEncoding outside Latin-1 */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‹': 0x8b,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '›': 0x9b
};

/** The WinAnsi byte of a character, '?' (63) when the font cannot show it */
function winAnsiByte(ch: string): number {
  const code = ch.codePointAt(0) ?? 63;
  if (code >= 32 && code <= 126) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return WIN_ANSI[ch] ?? 63;
}

function charWidth(ch: string, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  const code = ch.codePointAt(0) ?? 63;
  if (code >= 32 && code <= 126) return table[code - 32];
  // Accented letters as their base letter (ä as a)
  const base = ch.normalize('NFD')[0];
  const b = base.codePointAt(0) ?? 63;
  if (b >= 32 && b <= 126) return table[b - 32];
  return 556;
}

/** Width of a text in points */
export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

/** A PDF string literal: WinAnsi bytes, ( ) \ escaped, others above 126 as octal */
export function pdfString(text: string): string {
  let out = '(';
  for (const ch of text.replace(/[\r\n\t]+/g, ' ')) {
    const b = winAnsiByte(ch);
    if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
    else if (b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out + ')';
}

/** Lines of at most `width` points; a word too long on its own is cut */
export function wrapText(text: string, width: number, size: number, bold = false): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, bold) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (textWidth(rest, size, bold) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > width) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

class PageWriter {
  pages: string[][] = [];
  y = 0;

  get ops() {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push([]);
    this.y = PAGE_H - MARGIN;
  }

  text(x: number, y: number, text: string, size: number, bold = false, gray = false) {
    if (!text) return;
    const color = gray ? '0.4 g ' : '';
    this.ops.push(
      `BT ${color}/${bold ? 'F2' : 'F1'} ${size} Tf ${num(x)} ${num(y)} Td ${pdfString(text)} Tj ET`
    );
  }

  rule(y: number, width = CONTENT_W, gray = 0.75) {
    this.ops.push(
      `${gray} G 0.5 w ${num(MARGIN)} ${num(y)} m ${num(MARGIN + width)} ${num(y)} l S`
    );
  }

  fill(y: number, height: number, width = CONTENT_W) {
    this.ops.push(`0.93 g ${num(MARGIN)} ${num(y)} ${num(width)} ${num(height)} re f 0 g`);
  }
}

const BOTTOM = MARGIN + 24;

function cellLines(table: PdfTable, row: string[], bold: boolean): string[][] {
  return table.columns.map((c, i) => wrapText(row[i] ?? '', c.width - 2 * PAD, FONT, bold));
}

function drawRow(w: PageWriter, table: PdfTable, lines: string[][], bold: boolean, shaded = false) {
  const height = Math.max(...lines.map((l) => l.length)) * LINE + 2 * PAD;
  const width = table.columns.reduce((n, c) => n + c.width, 0);
  if (shaded) w.fill(w.y - height, height, width);
  let x = MARGIN;
  table.columns.forEach((c, i) => {
    lines[i].forEach((line, j) => {
      const baseline = w.y - PAD - (j + 1) * LINE + 2.5;
      const tx = c.align === 'right' ? x + c.width - PAD - textWidth(line, FONT, bold) : x + PAD;
      w.text(tx, baseline, line, FONT, bold);
    });
    x += c.width;
  });
  w.y -= height;
  w.rule(w.y, width);
}

function rowHeight(lines: string[][]): number {
  return Math.max(...lines.map((l) => l.length)) * LINE + 2 * PAD;
}

function drawTable(w: PageWriter, table: PdfTable) {
  const header = cellLines(
    table,
    table.columns.map((c) => c.label),
    true
  );
  const headerH = rowHeight(header);
  const noteLines = table.note ? wrapText(table.note, CONTENT_W, FONT) : [];
  const firstRow = table.rows[0] ? rowHeight(cellLines(table, table.rows[0], false)) : 0;

  // Heading, note, header and the first row stay together
  if (w.y - (22 + noteLines.length * LINE + headerH + firstRow) < BOTTOM) w.newPage();
  w.y -= 14;
  w.text(MARGIN, w.y, table.heading, 12, true);
  w.y -= 8;
  for (const line of noteLines) {
    w.y -= LINE;
    w.text(MARGIN, w.y + 2, line, FONT, false, true);
  }
  if (noteLines.length) w.y -= 4;
  drawRow(w, table, header, true, true);

  const rows: [string[], boolean][] = table.rows.map((r) => [r, false]);
  if (table.footer) rows.push([table.footer, true]);
  for (const [row, bold] of rows) {
    const lines = cellLines(table, row, bold);
    if (w.y - rowHeight(lines) < BOTTOM) {
      w.newPage();
      drawRow(w, table, header, true, true);
    }
    drawRow(w, table, lines, bold);
  }
  w.y -= 10;
}

/** The finished PDF file */
export function buildPdf(doc: PdfDocument): Uint8Array<ArrayBuffer> {
  const w = new PageWriter();
  w.newPage();
  w.y -= 14;
  w.text(MARGIN, w.y, doc.title, 16, true);
  if (doc.subtitle) {
    w.y -= 16;
    w.text(MARGIN, w.y, doc.subtitle, 10);
  }
  w.y -= 6;
  for (const table of doc.tables) drawTable(w, table);

  const pages = w.pages.length;
  w.pages.forEach((ops, i) => {
    const y = MARGIN - 4;
    if (doc.footer)
      ops.push(`BT 0.4 g /F1 8 Tf ${num(MARGIN)} ${y} Td ${pdfString(doc.footer)} Tj ET`);
    if (doc.pageLabel) {
      const label = doc.pageLabel(i + 1, pages);
      const x = PAGE_W - MARGIN - textWidth(label, 8);
      ops.push(`BT 0.4 g /F1 8 Tf ${num(x)} ${y} Td ${pdfString(label)} Tj ET`);
    }
  });

  // Objects: 1 catalog, 2 pages, 3 and 4 fonts, then page and content pairs
  const objects: string[] = [];
  const kids = w.pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );
  w.pages.forEach((ops, i) => {
    const content = ops.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  // Everything is ASCII, so string offsets are byte offsets
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}
