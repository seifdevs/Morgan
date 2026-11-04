import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { financialReportPdf } from '../server/lib/reportPdf.mjs';

test('financial report PDF is a valid multi-section document with forecast and source summaries', async () => {
  const blankPnl = { year: 2026, months: Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`), income: [{ category: 'Client work', months: Array(12).fill(0), total: 125000 }], expenses: [{ category: 'Software', months: Array(12).fill(0), total: 25000 }] };
  blankPnl.income[0].months[10] = 125000; blankPnl.expenses[0].months[10] = 25000;
  const daily = Array.from({ length: 90 }, (_, i) => ({ date: `2026-11-${String(i + 3).padStart(2, '0')}`, inflowsCents: 100, outflowsCents: 30, balanceCents: 50000 + i * 70 }));
  const report = financialReportPdf({ business: { name: 'Morgan Report Test', currency: 'USD' }, year: 2026, pnl: blankPnl, overview: { asOf: '2026-11-02', cashCents: 50000, cashAsOf: '2026-11-02', forecastCommentary: 'No reserve breach in this test.' }, forecast: { confidence: { level: 'medium', score: 62, historyDays: 45 }, assumptions: { collectionRates: { base: '90% invoice receipts' }, paymentTiming: 'Invoice dates use customer history.' }, checkpoints: [30, 60, 90].map((days) => ({ days, conservativeCents: 40000, baseCents: 50000, optimisticCents: 60000 })), forecasts: { base: daily }, lowPoint: { date: '2026-11-15', balanceCents: 45000 } }, invoices: [], bills: [] });
  assert.equal(report.subarray(0, 5).toString(), '%PDF-');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(report), useSystemFonts: true }).promise;
  assert.ok(pdf.numPages >= 1);
  const text = [];
  for (let i = 1; i <= pdf.numPages; i++) text.push(...(await (await pdf.getPage(i)).getTextContent()).items.flatMap((item) => 'str' in item ? [item.str] : []));
  assert.match(text.join(' '), /Morgan Report Test/);
  assert.match(text.join(' '), /Monthly recorded activity/i);
  assert.match(text.join(' '), /Cash flow outlook/i);
  assert.match(text.join(' '), /Open invoices/i);
  assert.match(text.join(' '), /Unpaid bills/i);
});
