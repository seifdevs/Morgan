import test from 'node:test';
import assert from 'node:assert/strict';
import { insights, monthlySeries, profitAndLoss, spending, totals } from '../server/lib/analytics.mjs';
import { horizonForecast } from '../server/lib/horizon.mjs';

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

test('Horizon builds daily 90-day estimates from real invoices, bills, plans and integer-cent history', () => {
  const txns = [{ date: '2026-11-01', amountCents: 9000, financialClass: 'income' }, { date: '2026-11-02', amountCents: -4000, financialClass: 'expense' }];
  const invoice = { id: 'invoice-1', displayStatus: 'sent', dueDate: '2026-11-04', balanceDue: 100000, number: 'I-1', customer: { name: 'Client' } };
  const bill = { _id: 'bill-1', status: 'unpaid', dueDate: '2026-11-03', balanceDueCents: 25000, vendor: 'Vendor' };
  const plan = { _id: 'plan-1', name: 'Retainer', type: 'income', amountCents: 50000, cadence: 'monthly', nextDate: '2026-11-05', confidence: 'contracted' };
  const common = { txns, invoices: [invoice], bills: [bill], plannedItems: [plan], today: '2026-11-02', startingCash: 200000 };
  const base = horizonForecast(common);
  assert.equal(base.forecasts.base.length, 90);
  assert.equal(base.forecasts.base[0].date, '2026-11-03');
  assert.equal(base.checkpoints.length, 3);
  assert.ok(base.checkpoints.every((p) => p.optimisticCents >= p.baseCents && p.baseCents >= p.conservativeCents));
  assert.equal(base.forecasts.base[0].movements[0].type, 'bill');
  const hiring = horizonForecast({ ...common, scenario: { name: 'Hire', assumptions: [{ type: 'hire', name: 'Designer', startDate: '2026-11-03', amountCents: 30000, cadence: 'monthly' }] } });
  assert.ok(hiring.checkpoints[0].baseCents < base.checkpoints[0].baseCents);
  const addedClient = horizonForecast({ ...common, scenario: { name: 'New client', assumptions: [{ type: 'new-client', name: 'New retainer', startDate: '2026-11-03', amountCents: 60000, cadence: 'once' }] } });
  const lostClient = horizonForecast({ ...common, scenario: { name: 'Lost client', assumptions: [{ type: 'lost-client', name: 'Lost retainer', startDate: '2026-11-03', amountCents: 60000, cadence: 'once' }] } });
  const moreCosts = horizonForecast({ ...common, scenario: { name: 'Higher costs', assumptions: [{ type: 'increased-expense', name: 'Insurance', startDate: '2026-11-03', amountCents: 60000, cadence: 'once' }] } });
  assert.ok(addedClient.checkpoints[0].baseCents > base.checkpoints[0].baseCents);
  assert.ok(lostClient.checkpoints[0].baseCents < base.checkpoints[0].baseCents);
  assert.ok(moreCosts.checkpoints[0].baseCents < base.checkpoints[0].baseCents);
  const delayed = horizonForecast({ ...common, scenario: { name: 'Delay', assumptions: [{ type: 'delayed-payments', name: 'Slow receipts', startDate: '2026-11-03', delayDays: 12 }] } });
  assert.ok(delayed.forecasts.base.find((r) => r.date === '2026-11-04').balanceCents < base.forecasts.base.find((r) => r.date === '2026-11-04').balanceCents);
  const paymentHistory = [
    { id: 'paid-old', status: 'paid', customerId: 'client-1', customer: { name: 'Client' }, dueDate: '2026-10-20', payments: [{ date: '2026-10-30', amountCents: 10000 }] },
    { id: 'open', displayStatus: 'sent', customerId: 'client-1', customer: { name: 'Client' }, number: 'I-2', dueDate: '2026-11-15', balanceDue: 20000 },
  ];
  const withPaymentPrediction = horizonForecast({ txns: [], invoices: paymentHistory, bills: [], today: '2026-11-02', startingCash: 50000 });
  const predicted = withPaymentPrediction.events.find((e) => e.id === 'open');
  assert.equal(predicted.date, '2026-11-25');
  assert.deepEqual(predicted.paymentPrediction, { delayDays: 10, observations: 1 });
});

test('Monitor identifies large charges against the vendor’s own recent record', () => {
  const txns = [
    { _id: 'a', date: '2026-06-03', vendor: 'Studio Supply', description: 'Supplies', amountCents: -10000 },
    { _id: 'b', date: '2026-07-03', vendor: 'Studio Supply', description: 'Supplies', amountCents: -10000 },
    { _id: 'c', date: '2026-08-03', vendor: 'Studio Supply', description: 'Supplies', amountCents: -10000 },
    { _id: 'd', date: '2026-10-30', vendor: 'Studio Supply', description: 'Supplies', amountCents: -75000 },
  ];
  const alerts = insights({ txns, invoices: [], bills: [], today: '2026-11-02', currencyFmt: (c) => `$${(c / 100).toFixed(2)}` });
  const unusual = alerts.find((item) => item.kind === 'unusual-expense');
  assert.ok(unusual);
  assert.equal(unusual.amountCents, 75000);
  assert.deepEqual(unusual.evidence, ['d']);
});
