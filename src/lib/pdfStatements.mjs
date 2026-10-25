import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfTextRows } from './pdfTextRows.mjs';

/** Extract selectable text from a bounded PDF and return a reviewable row/column grid. */
export async function parsePdfStatement(buffer, maxPages = 100, workerSrc) {
  if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const data = new Uint8Array(buffer);
  const task = pdfjs.getDocument({ data, useSystemFonts: true });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > maxPages) throw new Error(`This PDF has ${pdf.numPages} pages. Imports are limited to ${maxPages} pages.`);
    const rows = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const positioned = content.items.flatMap((item) => {
        if (!('str' in item) || !item.str.trim()) return [];
        return [{ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width }];
      });
      rows.push(...pdfTextRows(positioned));
      page.cleanup();
    }
    if (!rows.some((row) => row.some((cell) => cell.trim()))) {
      throw new Error('No selectable text was found. Scanned PDF OCR is not available here; export the statement as CSV or XLSX.');
    }
    return rows;
  } finally {
    await task.destroy();
  }
}
