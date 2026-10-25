import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseXlsx } from '../src/lib/spreadsheets.mjs';
import { pdfTextRows } from '../src/lib/pdfTextRows.mjs';
import { parsePdfStatement } from '../src/lib/pdfStatements.mjs';
import { detectStatementColumns } from '../src/lib/statementMapping.mjs';
import { invoicePdf } from '../server/lib/pdf.mjs';

test('XLSX statement parser reads the first worksheet and normalizes dates and cell values', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Statement');
  sheet.addRow(['Transaction date', 'Description', 'Debit', 'Credit', 'Reference']);
  sheet.addRow([new Date('2026-10-01T00:00:00Z'), 'Office supplies', 42.5, null, 'REF-1']);
  const raw = await workbook.xlsx.writeBuffer();
  const parsed = await parseXlsx(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  assert.deepEqual(parsed, [
    ['Transaction date', 'Description', 'Debit', 'Credit', 'Reference'],
    ['2026-10-01', 'Office supplies', '42.5', '', 'REF-1'],
  ]);
});

test('statement mapping distinguishes debit and credit amounts from a signed amount column', () => {
  assert.deepEqual(detectStatementColumns(['Posted Date', 'Narrative', 'Debit Amount', 'Credit Amount', 'Balance']), {
    date: 0, description: 1, debit: 2, credit: 3, balance: 4,
  });
  assert.deepEqual(detectStatementColumns(['Transaction Date', 'Merchant', 'Signed Amount', 'Reference']), {
    date: 0, amount: 2, vendor: 1, reference: 3,
  });
});

test('PDF text rows group words by baseline and split visible columns', () => {
  const items = [
    { str: '2026-10-01', x: 10, y: 700, width: 48 },
    { str: 'Office', x: 70, y: 700, width: 24 },
    { str: 'supplies', x: 97, y: 700, width: 33 },
    { str: '-42.50', x: 220, y: 700, width: 30 },
    { str: 'Date', x: 10, y: 720, width: 20 },
    { str: 'Description', x: 70, y: 720, width: 44 },
    { str: 'Amount', x: 220, y: 720, width: 30 },
  ];
  assert.deepEqual(pdfTextRows(items), [
    ['Date', 'Description', 'Amount'],
    ['2026-10-01', 'Office supplies', '-42.50'],
  ]);
});

test('text PDF parser extracts page text for the review and mapping step', async () => {
  const pdf = invoicePdf({ number: 'INV-1', issueDate: '2026-10-01', dueDate: '2026-10-15', customer: { name: 'Sample Client' }, items: [{ description: 'Cash deposit', quantity: 1, unitCents: 12345 }], taxRateBps: 0, totals: { subtotal: 12345, discount: 0, tax: 0, total: 12345 }, amountPaid: 0, balanceDue: 12345 }, { name: 'Sample Business', currency: 'USD' });
  const rows = await parsePdfStatement(pdf);
  const text = rows.flat().join(' ');
  assert.match(text, /2026-10-01/);
  assert.match(text, /Cash deposit/);
  assert.match(text, /123\.45/);
});
