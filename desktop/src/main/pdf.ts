/**
 * Printable reports. Instead of printing the app window (sidebar, dark theme, scroll
 * containers), every PDF / print job renders a dedicated, self-contained A4 document in a
 * hidden window: white page, table header repeated on every page, numbers right-aligned,
 * landscape for wide tables, "Page x of y" footer. Nothing leaves the PC.
 * The document itself is built by shared/print.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { isLandscape, printHtml, type PrintDoc } from '../shared/print';

const FOOTER = `<div style="font: 7pt 'Segoe UI', Arial, sans-serif; color: #7a8391; width: 100%; padding: 0 0.45in; display: flex; justify-content: space-between;">
<span>EMI Tracker · generated on this PC · keep private</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

/** Loads the document in a hidden, script-less window and hands it to `use`. */
async function withDocument<T>(doc: PrintDoc, run: (w: BrowserWindow) => Promise<T>): Promise<T> {
  const dir = path.join(app.getPath('userData'), 'print-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `report-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(file, printHtml(doc), 'utf8');
  const w = new BrowserWindow({ show: false, width: 1123, height: 794, backgroundColor: '#ffffff', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await w.loadFile(file);
    return await run(w);
  } finally {
    if (!w.isDestroyed()) w.destroy();
    fs.rmSync(file, { force: true });
  }
}

export function renderPdf(doc: PrintDoc): Promise<Buffer> {
  return withDocument(doc, (w) => w.webContents.printToPDF({
    pageSize: 'A4', landscape: isLandscape(doc), printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>', footerTemplate: FOOTER, margins: { top: 0.45, bottom: 0.55, left: 0.45, right: 0.45 },
  }));
}

export function printDoc(doc: PrintDoc): Promise<boolean> {
  return withDocument(doc, (w) => new Promise((resolve, reject) => {
    w.webContents.print({ printBackground: true, landscape: isLandscape(doc) }, (ok, reason) => (ok || reason === 'cancelled' ? resolve(ok) : reject(new Error(reason))));
  }));
}
