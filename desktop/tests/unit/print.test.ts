/** Printable report documents (rendered to PDF by the main process). */
import { describe, expect, it } from 'vitest';
import { isLandscape, printDocSchema, printHtml, type PrintDoc } from '../../src/shared/print';

const doc: PrintDoc = {
  title: 'Loan summary', subtitle: 'Generated 28 Oct 2026', summary: [{ label: 'Outstanding', value: '₹95,000.00' }],
  head: ['Loan', 'Lender', 'Principal'], align: ['left', 'left', 'right'],
  rows: [['<script>alert(1)</script>', 'Sharma & Sons', '₹1,00,000.00']], totals: ['Total', '', '₹1,00,000.00'],
};

describe('print document', () => {
  it('is a white, self-contained page with escaped content', () => {
    const html = printHtml(printDocSchema.parse(doc));
    expect(html).toContain('background: #fff');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Sharma &amp; Sons');
    expect(html).toContain('<td class="r">₹1,00,000.00</td>');
    expect(html).toContain('<tfoot>');
    expect(html).toContain('display: table-header-group'); // header repeats on every page
    expect(html).not.toMatch(/https?:\/\//); // nothing external
  });

  it('uses landscape for wide tables', () => {
    expect(isLandscape(doc)).toBe(false);
    const wide = { ...doc, head: Array.from({ length: 12 }, (_, i) => `C${i}`), align: Array(12).fill('right') as PrintDoc['align'] };
    expect(isLandscape(wide)).toBe(true);
    expect(printHtml(wide)).toContain('A4 landscape');
  });

  it('shows a message for an empty report', () => {
    expect(printHtml({ ...doc, rows: [], totals: null })).toContain('No data for these filters.');
  });
});
