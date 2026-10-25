import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlySeries, profitAndLoss, spending, totals } from '../server/lib/analytics.mjs';

test('raw bank movements change cash movement without becoming income or spending', () => {
  const txns = [
    { date: '2026-10-01', amountCents: 25000, source: 'bank-statement', financialClass: 'unclassified' },
    { date: '2026-10-02', amountCents: -9000, source: 'bank-statement', financialClass: 'unclassified' },
    { date: '2026-10-03', amountCents: -3000, source: 'manual', financialClass: 'expense', category: 'Rent' },
    { date: '2026-10-04', amountCents: 5000, source: 'invoice-payment', financialClass: 'income', category: 'Client revenue' },
  ];
  assert.deepEqual(totals(txns, '2026-10-01', '2026-10-31'), { income: 5000, expenses: 3000, net: 18000, operatingNet: 2000 });
  assert.deepEqual(monthlySeries(txns, ['2026-10'])[0], { month: '2026-10', income: 5000, expenses: 3000, net: 18000 });
  assert.equal(spending(txns, '2026-10-01', '2026-10-31').total, 3000);
  const pnl = profitAndLoss(txns, 2026);
  assert.equal(pnl.income.reduce((s, row) => s + row.total, 0), 5000);
  assert.equal(pnl.expenses.reduce((s, row) => s + row.total, 0), 3000);
});

test('legacy manual transactions retain their sign-based classification', () => {
  const txns = [
    { date: '2026-04-01', amountCents: 1200, source: 'manual' },
    { date: '2026-04-02', amountCents: -400, source: 'import' },
    { date: '2026-04-03', amountCents: 900, source: 'bank-statement' },
  ];
  assert.deepEqual(totals(txns, '2026-04-01', '2026-04-30'), { income: 1200, expenses: 400, net: 1700, operatingNet: 800 });
});

test('expense refunds reduce the same category without becoming revenue', () => {
  const txns = [
    { date: '2026-05-01', amountCents: -10000, financialClass: 'expense', category: 'Travel' },
    { date: '2026-05-04', amountCents: 2500, financialClass: 'refund', category: 'Travel' },
  ];
  assert.deepEqual(totals(txns, '2026-05-01', '2026-05-31'), { income: 0, expenses: 7500, net: -7500, operatingNet: -7500 });
  assert.equal(spending(txns, '2026-05-01', '2026-05-31').total, 7500);
  const report = profitAndLoss(txns, 2026);
  assert.equal(report.income.length, 0);
  assert.equal(report.expenses[0].total, 7500);
});
