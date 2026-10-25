import test from 'node:test';
import assert from 'node:assert/strict';
// Node 22.18+/24 strips TypeScript types natively.
import { parseCsv, toCsv, normaliseDate } from '../src/lib/csv.ts';

test('CSV export neutralises formula injection', () => {
  const out = toCsv([['=HYPERLINK("x")', '-2+3+cmd|\' /C calc\'!A0', '@SUM(A1)', '+1', '\t=1', '-12.50', '1250', 'plain']]);
  const cells = parseCsv(out)[0];
  assert.deepEqual(cells, ["'=HYPERLINK(\"x\")", "'-2+3+cmd|' /C calc'!A0", "'@SUM(A1)", "'+1", "'\t=1", '-12.50', '1250', 'plain']);
});

test('CSV parser handles quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\r\n\r\n'), [['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  assert.equal(normaliseDate('10/02/2026'), '2026-10-02');
  assert.equal(normaliseDate('2026/1/5'), '2026-01-05');
});

test('CSV parser detects BOM and alternate delimiters', () => {
  assert.deepEqual(parseCsv('\uFEFFDate;Description;Amount\r\n2026-10-01;"Coffee; meeting";-12,50\r\n'), [['Date', 'Description', 'Amount'], ['2026-10-01', 'Coffee; meeting', '-12,50']]);
  assert.deepEqual(parseCsv('Date\tDescription\tAmount\n2026-10-01\tTea\t4.00'), [['Date', 'Description', 'Amount'], ['2026-10-01', 'Tea', '4.00']]);
});
