import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { parsePdfStatement as extractPdfStatement } from './pdfStatements.mjs';

export function parsePdfStatement(buffer: ArrayBuffer, maxPages = 100) {
  return extractPdfStatement(buffer, maxPages, workerUrl);
}
