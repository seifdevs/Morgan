import { addDays } from './validate.mjs';

const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const nextDate = (iso, cadence) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else {
    const m = cadence === 'quarterly' ? 3 : cadence === 'annually' ? 12 : 1;
    const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return d.toISOString().slice(0, 10);
};
const endAfterMonths = (iso, months) => {
  const d = new Date(`${iso}T00:00:00Z`), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months - 1);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
};

const probability = (mode, confidence, inflow) => {
  if (confidence === 'scenario') return 1;
  const values = {
    conservative: { confirmed: 1, invoiced: .7, contracted: .65, estimated: .4, planned: .2 },
    base: { confirmed: 1, invoiced: .9, contracted: .85, estimated: .7, planned: .5 },
    optimistic: { confirmed: 1, invoiced: .98, contracted: .95, estimated: .85, planned: .75 },
  };
  if (!inflow) return mode === 'conservative' ? .95 : mode === 'optimistic' ? .8 : .9;
  return values[mode][confidence] ?? values[mode].planned;
};

function predictedCustomerDelay(invoice, invoices) {
  const key = invoice.customerId || invoice.customer?.name?.trim().toLowerCase();
  const history = invoices.filter((item) => {
    const other = item.customerId || item.customer?.name?.trim().toLowerCase();
    return key && other === key && item.status === 'paid' && (item.payments || []).length;
  }).sort((a, b) => b.dueDate.localeCompare(a.dueDate)).slice(0, 5);
  if (!history.length) return { delayDays: 0, observations: 0 };
  const deltas = history.map((item) => {
    const settled = [...item.payments].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date || item.paidDate || item.dueDate;
    return Math.max(-30, Math.min(60, dayDiff(item.dueDate, settled)));
  });
  return { delayDays: Math.round(deltas.reduce((sum, n) => sum + n, 0) / deltas.length), observations: history.length };
}

function scenarioEvents(assumptions, today, end) {
  const events = [];
  for (const a of assumptions || []) {
    if (a.type === 'delayed-payments') continue;
    const start = a.startDate < today ? today : a.startDate;
    const sign = a.type === 'lost-client' ? -1 : ['new-client'].includes(a.type) ? 1 : -1;
    const income = ['lost-client', 'new-client'].includes(a.type);
    const cadence = a.type === 'large-purchase' ? 'once' : a.cadence || 'monthly';
    const until = a.durationMonths ? endAfterMonths(start, a.durationMonths) : end;
    for (let d = start, n = 0; d <= end && d <= until && n < 100; n++) {
      events.push({ date: d, type: 'scenario', id: String(a.id || a.type), label: a.name || a.type.replaceAll('-', ' '), amountCents: sign * a.amountCents, confidence: 'scenario', income: sign > 0, cadence });
      if (cadence === 'once') break;
      const following = nextDate(d, cadence); if (following <= d) break; d = following;
    }
  }
  return events;
}

/** Daily business cash projection. Only estimates are probability-weighted; source amounts remain integer cents. */
export function horizonForecast({ txns, invoices, bills, plannedItems = [], today, startingCash, days = 90, scenario = null }) {
  const end = addDays(today, days);
  const events = [];
  for (const invoice of invoices) {
    if (!['sent', 'partial', 'overdue'].includes(invoice.displayStatus)) continue;
    const delayDays = (scenario?.assumptions || []).filter((a) => a.type === 'delayed-payments').reduce((n, a) => n + a.delayDays, 0);
    const paymentPrediction = predictedCustomerDelay(invoice, invoices);
    const adjusted = addDays(invoice.dueDate, paymentPrediction.delayDays + delayDays);
    const date = adjusted < today ? today : adjusted;
    if (date <= end && invoice.balanceDue > 0) events.push({ date, type: 'invoice', id: invoice.id, label: `${invoice.number} · ${invoice.customer.name}`, amountCents: invoice.balanceDue, confidence: 'invoiced', income: true, paymentPrediction });
  }
  for (const bill of bills) {
    if (!['unpaid', 'partial'].includes(bill.status)) continue;
    const amount = bill.balanceDueCents ?? bill.amountCents;
    const date = bill.dueDate < today ? today : bill.dueDate;
    if (date <= end && amount > 0) events.push({ date, type: 'bill', id: String(bill._id || bill.id), label: bill.vendor, amountCents: -amount, confidence: 'confirmed', income: false });
  }
  for (const item of plannedItems) {
    if (item.confidence === 'invoiced') continue;
    for (let date = item.nextDate, n = 0; date <= end && (!item.endDate || date <= item.endDate) && n < 100; n++) {
      if (date >= today) events.push({ date, type: 'planned', id: String(item._id || item.id), label: item.name, amountCents: item.type === 'income' ? item.amountCents : -item.amountCents, confidence: item.confidence || 'planned', income: item.type === 'income' });
      if (item.cadence === 'once') break;
      const following = nextDate(date, item.cadence); if (following <= date) break; date = following;
    }
  }
  if (scenario?.assumptions) events.push(...scenarioEvents(scenario.assumptions, today, end));

  const historyFrom = addDays(today, -89);
  const history = txns.filter((t) => t.date >= historyFrom && t.date <= today && !t.invoiceId && !t.billId && !t.excludedFromTotals);
  const firstRecorded = history.reduce((d, t) => t.date < d ? t.date : d, today);
  const daysObserved = history.length ? Math.max(1, Math.min(90, dayDiff(firstRecorded, today) + 1)) : 0;
  const runRateCentsPerDay = daysObserved ? Math.round(history.reduce((s, t) => s + t.amountCents, 0) / daysObserved) : 0;
  const classifiedRatio = history.length ? history.filter((t) => t.financialClass !== 'unclassified').length / history.length : 0;
  const historyFactor = Math.min(1, daysObserved / 60);
  const eventCoverage = events.length ? events.filter((e) => e.confidence === 'confirmed').length / events.length : .5;
  const confidenceScore = Math.round(Math.max(15, Math.min(95, 30 + historyFactor * 35 + classifiedRatio * 15 + eventCoverage * 15)));
  const confidence = confidenceScore >= 75 ? 'high' : confidenceScore >= 50 ? 'medium' : 'low';
  const modes = ['conservative', 'base', 'optimistic'];
  const rowsByMode = modes.map((mode) => {
    let balance = startingCash;
    const rows = [];
    for (let i = 1; i <= days; i++) {
      const date = addDays(today, i);
      const dayEvents = events.filter((e) => e.date === date);
      const scheduled = dayEvents.reduce((sum, e) => sum + Math.round(e.amountCents * probability(mode, e.confidence, e.amountCents > 0)), 0);
      // Historical run-rate remains an estimate, never a recorded or contracted movement.
      const runRateFactor = runRateCentsPerDay < 0 ? (mode === 'conservative' ? 1.25 : mode === 'optimistic' ? .75 : 1) : (mode === 'conservative' ? .75 : mode === 'optimistic' ? 1.25 : 1);
      const runRate = Math.round(runRateCentsPerDay * runRateFactor);
      const net = scheduled + runRate;
      if (balance !== null) balance += net;
      rows.push({ date, openingBalanceCents: balance === null ? null : balance - net, inflowsCents: dayEvents.filter((e) => e.amountCents > 0).reduce((s, e) => s + Math.round(e.amountCents * probability(mode, e.confidence, true)), 0) + Math.max(0, runRate), outflowsCents: dayEvents.filter((e) => e.amountCents < 0).reduce((s, e) => s + Math.abs(Math.round(e.amountCents * probability(mode, e.confidence, false))), 0) + Math.max(0, -runRate), netCents: net, balanceCents: balance, movements: dayEvents.map((e) => ({ ...e, projectedAmountCents: Math.round(e.amountCents * probability(mode, e.confidence, e.amountCents > 0)) })) });
    }
    return [mode, rows];
  });
  const results = Object.fromEntries(rowsByMode);
  const checkpoints = [30, 60, 90].filter((n) => n <= days).map((n) => ({ days: n, conservativeCents: results.conservative[n - 1]?.balanceCents ?? null, baseCents: results.base[n - 1]?.balanceCents ?? null, optimisticCents: results.optimistic[n - 1]?.balanceCents ?? null }));
  const bases = results.base;
  const low = bases.reduce((lowest, row) => row.balanceCents !== null && (lowest === null || row.balanceCents < lowest.balanceCents) ? row : lowest, null);
  return {
    today, end, days, openingBalanceCents: startingCash,
    confidence: { score: confidenceScore, level: confidence, historyDays: daysObserved, classifiedTransactions: classifiedRatio },
    assumptions: { runRateCentsPerDay, runRateSource: 'last 90 days of unlinked recorded transactions', paymentTiming: 'Invoice dates use the customer’s average settlement delay across up to five paid invoices, when available; otherwise the invoice due date.', collectionRates: { conservative: '70% invoiced, 65% contracted, 40% estimated, 20% planned', base: '90% invoiced, 85% contracted, 70% estimated, 50% planned', optimistic: '98% invoiced, 95% contracted, 85% estimated, 75% planned' }, bills: '100% in all cases', scenario: scenario?.name || null },
    checkpoints, lowPoint: low ? { date: low.date, balanceCents: low.balanceCents } : null,
    forecasts: results,
    events: events.sort((a, b) => a.date.localeCompare(b.date)).map((event) => ({ ...event, projectedAmountCents: Math.round(event.amountCents * probability('base', event.confidence, event.amountCents > 0)) })),
  };
}
