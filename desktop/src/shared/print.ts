/** Self-contained printable report document (HTML), rendered to PDF by the main process. */
import { z } from 'zod';

export const printDocSchema = z.object({
  title: z.string().max(200),
  subtitle: z.string().max(500),
  note: z.string().max(2000).optional(),
  summary: z.array(z.object({ label: z.string().max(100), value: z.string().max(100) })).max(8).optional(),
  head: z.array(z.string().max(100)).min(1).max(30),
  align: z.array(z.enum(['left', 'right'])).max(30),
  rows: z.array(z.array(z.string().max(500))).max(100_000),
  totals: z.array(z.string().max(100)).max(30).nullable().optional(),
});
export type PrintDoc = z.infer<typeof printDocSchema>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const isLandscape = (doc: PrintDoc) => doc.head.length > 7;

export function printHtml(doc: PrintDoc): string {
  const cols = doc.head.length;
  const size = cols > 12 ? 7.4 : cols > 9 ? 8.2 : 9.4;
  const cls = (i: number) => (doc.align[i] === 'right' ? ' class="r"' : '');
  const row = (cells: string[], tag: 'td' | 'th') => `<tr>${cells.map((c, i) => `<${tag}${cls(i)}>${esc(c)}</${tag}>`).join('')}</tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
@page { size: A4 ${isLandscape(doc) ? 'landscape' : 'portrait'}; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #14171c; }
body { font: ${size}pt/1.35 "Segoe UI", "Nirmala UI", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1f4fd1; padding-bottom: 8px; margin-bottom: 12px; }
h1 { font-size: 17pt; margin: 0 0 2px; letter-spacing: -0.2px; }
.sub { color: #5b6472; font-size: 9pt; }
.brand { color: #1f4fd1; font-weight: 600; font-size: 9pt; white-space: nowrap; }
.note { background: #f5f7fb; border-left: 3px solid #9aa6b8; padding: 6px 9px; margin: 0 0 10px; color: #3b4350; font-size: 8.5pt; }
.stats { display: flex; gap: 8px; margin: 0 0 12px; }
.stat { flex: 1; border: 1px solid #e1e5ec; border-radius: 6px; padding: 7px 9px; }
.stat b { display: block; font-size: 12pt; margin-top: 2px; }
.stat span { color: #5b6472; font-size: 7.6pt; text-transform: uppercase; letter-spacing: 0.4px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { background: #eef1f6; color: #3b4350; font-weight: 600; font-size: 0.86em; text-transform: uppercase; letter-spacing: 0.3px; text-align: left; padding: 6px 6px; border-bottom: 1px solid #cfd5df; }
td { padding: 5px 6px; border-bottom: 1px solid #e6e9ef; vertical-align: top; overflow-wrap: anywhere; }
tbody tr:nth-child(even) td { background: #fafbfd; }
tr { break-inside: avoid; }
.r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 700; border-top: 1.5px solid #8b95a5; border-bottom: none; background: #f5f7fb; }
.empty { color: #5b6472; padding: 14px 6px; }
</style></head><body>
<header><div><h1>${esc(doc.title)}</h1><div class="sub">${esc(doc.subtitle)}</div></div><div class="brand">EMI Tracker</div></header>
${doc.note ? `<div class="note">${esc(doc.note)}</div>` : ''}
${doc.summary?.length ? `<div class="stats">${doc.summary.map((s) => `<div class="stat"><span>${esc(s.label)}</span><b>${esc(s.value)}</b></div>`).join('')}</div>` : ''}
<table><thead>${row(doc.head, 'th')}</thead>
<tbody>${doc.rows.length ? doc.rows.map((r) => row(r, 'td')).join('') : `<tr><td class="empty" colspan="${cols}">No data for these filters.</td></tr>`}</tbody>
${doc.totals && doc.rows.length ? `<tfoot>${row(doc.totals, 'td')}</tfoot>` : ''}
</table></body></html>`;
}
