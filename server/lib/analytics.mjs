// Pure financial calculations over one business's records. All amounts are integer cents.
import { addDays } from './validate.mjs';

const month = (d) => d.slice(0, 7);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const inRange = (d, from, to) => d >= from && d <= to;
const fd = (d) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));

// A bank movement is not automatically revenue or an operating expense.
// Keep legacy manual records' sign-based meaning; raw statement rows need review.
export function transactionClass(t) {
  if (t.financialClass) return t.financialClass;
  if (t.invoiceId) return 'income';
  if (t.billId) return 'expense';
  if (t.matchedRecordType === 'transfer') return 'transfer';
  return t.source === 'bank-statement' ? 'unclassified' : (t.amountCents >= 0 ? 'income' : 'expense');
}

export function monthsBack(today, n) {
  const [y, m] = today.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Previous period of equal length ending the day before `from`. */
export function priorPeriod(from, to) {
  const len = daysBetween(from, to);
  const pTo = addDays(from, -1);
  return { from: addDays(pTo, -len), to: pTo };
}

export function cashBalance(txns, business, asOf) {
  const start = business.openingBalanceDate || '0000-01-01';
  return (business.openingBalanceCents || 0) +
    txns.filter((t) => t.date >= start && t.date <= asOf).reduce((s, t) => s + t.amountCents, 0);
}

export function totals(txns, from, to) {
  let income = 0, expenses = 0, net = 0;
  for (const t of txns) {
    if (!inRange(t.date, from, to)) continue;
    const cls = transactionClass(t);
    if (cls === 'income') income += Math.max(0, t.amountCents);
    if (cls === 'expense') expenses += Math.max(0, -t.amountCents);
    if (cls === 'refund') expenses -= Math.max(0, t.amountCents);
    net += t.amountCents;
  }
  return { income, expenses, net, operatingNet: income - expenses };
}

export function monthlySeries(txns, months) {
  const map = Object.fromEntries(months.map((m) => [m, { month: m, income: 0, expenses: 0, net: 0 }]));
  for (const t of txns) {
    const r = map[month(t.date)];
    if (!r) continue;
    const cls = transactionClass(t);
    if (cls === 'income') r.income += Math.max(0, t.amountCents);
    if (cls === 'expense') r.expenses += Math.max(0, -t.amountCents);
    if (cls === 'refund') r.expenses -= Math.max(0, t.amountCents);
    r.net += t.amountCents;
  }
  return months.map((m) => map[m]);
}

export function aging(invoices, today) {
  const buckets = [
    { key: 'current', label: 'Not yet due', amount: 0, count: 0 },
    { key: '1-30', label: '1–30 days', amount: 0, count: 0 },
    { key: '31-60', label: '31–60 days', amount: 0, count: 0 },
    { key: '61-90', label: '61–90 days', amount: 0, count: 0 },
    { key: '90+', label: '90+ days', amount: 0, count: 0 },
  ];
  for (const inv of invoices) {
    if (!['sent', 'partial', 'overdue'].includes(inv.displayStatus)) continue;
    const late = daysBetween(inv.dueDate, today);
    const b = late <= 0 ? buckets[0] : late <= 30 ? buckets[1] : late <= 60 ? buckets[2] : late <= 90 ? buckets[3] : buckets[4];
    b.amount += inv.balanceDue; b.count++;
  }
  return buckets;
}

function groupSum(txns, keyFn) {
  const m = new Map();
  for (const t of txns) {
    const k = keyFn(t) || 'Uncategorized';
    const r = m.get(k) || { name: k, amount: 0, count: 0 };
    r.amount += -t.amountCents; r.count++;
    m.set(k, r);
  }
  return m;
}

export function spending(txns, from, to) {
  const prior = priorPeriod(from, to);
  const cur = txns.filter((t) => ['expense', 'refund'].includes(transactionClass(t)) && inRange(t.date, from, to));
  const prev = txns.filter((t) => ['expense', 'refund'].includes(transactionClass(t)) && inRange(t.date, prior.from, prior.to));
  const merge = (keyFn) => {
    const a = groupSum(cur, keyFn), b = groupSum(prev, keyFn);
    const keys = new Set([...a.keys(), ...b.keys()]);
    return [...keys].map((k) => ({
      name: k, amount: a.get(k)?.amount || 0, count: a.get(k)?.count || 0, priorAmount: b.get(k)?.amount || 0,
    })).sort((x, y) => y.amount - x.amount || y.priorAmount - x.priorAmount);
  };
  const total = cur.reduce((s, t) => s - t.amountCents, 0);
  const priorTotal = prev.reduce((s, t) => s - t.amountCents, 0);
  // Daily cumulative spend for current vs prior period, aligned by day offset.
  const len = daysBetween(from, to) + 1;
  const curDaily = new Array(len).fill(0), prevDaily = new Array(len).fill(0);
  for (const t of cur) curDaily[daysBetween(from, t.date)] -= t.amountCents;
  for (const t of prev) { const i = daysBetween(prior.from, t.date); if (i < len) prevDaily[i] -= t.amountCents; }
  let ca = 0, pa = 0;
  const cumulative = curDaily.map((v, i) => ({ day: i, current: (ca += v), prior: (pa += prevDaily[i]) }));
  return { from, to, prior, total, priorTotal, count: cur.length, byCategory: merge((t) => t.category), byVendor: merge((t) => t.vendor || '(no vendor)'), cumulative };
}

/** Recurring = same vendor charged in >=3 distinct months of the window, amounts within 25% of median. */
export function recurringCharges(txns, today) {
  const since = addDays(today, -185);
  const byVendor = new Map();
  for (const t of txns) {
    if (transactionClass(t) !== 'expense' || t.amountCents >= 0 || t.date < since || !t.vendor) continue;
    const k = t.vendor.toLowerCase();
    (byVendor.get(k) || byVendor.set(k, []).get(k)).push(t);
  }
  const out = [];
  for (const list of byVendor.values()) {
    const months = new Set(list.map((t) => month(t.date)));
    if (months.size < 3) continue;
    const amounts = list.map((t) => -t.amountCents).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (!amounts.every((a) => Math.abs(a - median) <= median * 0.25)) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const last = -sorted.at(-1).amountCents, prev = -sorted.at(-2).amountCents;
    out.push({
      vendor: sorted.at(-1).vendor, typicalMonthly: median, annualized: median * 12, months: months.size,
      lastAmount: last, previousAmount: prev, lastDate: sorted.at(-1).date, ids: sorted.map((t) => String(t._id)),
    });
  }
  return out.sort((a, b) => b.annualized - a.annualized);
}

export function insights({ txns, invoices, bills, today, currencyFmt }) {
  const out = [];
  const f = currencyFmt;

  // 1. Possible duplicate charges: same vendor/description and amount within 3 days.
  const expenses = txns.filter((t) => transactionClass(t) === 'expense' && t.amountCents < 0).sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set();
  for (let i = 0; i < expenses.length; i++) {
    for (let j = i + 1; j < expenses.length && daysBetween(expenses[i].date, expenses[j].date) <= 3; j++) {
      const a = expenses[i], b = expenses[j];
      const ka = (a.vendor || a.description).toLowerCase(), kb = (b.vendor || b.description).toLowerCase();
      if (ka === kb && a.amountCents === b.amountCents && !seen.has(String(b._id))) {
        seen.add(String(b._id));
        out.push({
          id: `dup-${b._id}`, kind: 'duplicate', severity: 'high',
          title: `Possible duplicate charge: ${a.vendor || a.description}`,
          detail: `Two charges of ${f(-a.amountCents)} on ${fd(a.date)} and ${fd(b.date)}. If one is a duplicate, requesting a refund would recover ${f(-b.amountCents)}.`,
          amountCents: -b.amountCents, evidence: [String(a._id), String(b._id)], evidenceType: 'transaction',
        });
      }
    }
  }

  // 2. Recurring charges and price increases.
  for (const r of recurringCharges(txns, today)) {
    if (r.lastAmount > r.previousAmount * 1.05) {
      out.push({
        id: `price-${r.vendor}`, kind: 'price-increase', severity: 'medium',
        title: `${r.vendor} charged more than last time`,
        detail: `Latest charge ${f(r.lastAmount)} vs previous ${f(r.previousAmount)} (+${f(r.lastAmount - r.previousAmount)}). Confirm the change was expected.`,
        amountCents: r.lastAmount - r.previousAmount, evidence: r.ids.slice(-2), evidenceType: 'transaction',
      });
    }
    out.push({
      id: `rec-${r.vendor}`, kind: 'recurring', severity: 'low',
      title: `Recurring: ${r.vendor}`,
      detail: `Charged in ${r.months} of the last 6 months, typically ${f(r.typicalMonthly)}. At that rate it costs ${f(r.annualized)} a year — worth checking the plan and amount still fit.`,
      amountCents: r.annualized, evidence: r.ids, evidenceType: 'transaction',
    });
  }

  // 3. Vendors whose spend rose sharply: last 30 days vs the 30 before.
  const cur = groupSum(expenses.filter((t) => inRange(t.date, addDays(today, -29), today)), (t) => t.vendor);
  const prev = groupSum(expenses.filter((t) => inRange(t.date, addDays(today, -59), addDays(today, -30))), (t) => t.vendor);
  for (const [k, v] of cur) {
    const p = prev.get(k);
    if (!p || k === 'Uncategorized') continue;
    const diff = v.amount - p.amount;
    if (diff >= 10000 && v.amount >= p.amount * 1.25) {
      out.push({
        id: `vend-${k}`, kind: 'vendor-increase', severity: 'medium',
        title: `Spend with ${k} is up ${Math.round((v.amount / p.amount - 1) * 100)}%`,
        detail: `${f(v.amount)} in the last 30 days vs ${f(p.amount)} in the 30 days before (+${f(diff)}).`,
        amountCents: diff, evidence: expenses.filter((t) => t.vendor === k && t.date >= addDays(today, -59)).map((t) => String(t._id)), evidenceType: 'transaction',
      });
    }
  }

  // 4. Overdue receivables.
  const overdue = invoices.filter((i) => i.displayStatus === 'overdue');
  if (overdue.length) {
    const amt = overdue.reduce((s, i) => s + i.balanceDue, 0);
    out.push({
      id: 'overdue', kind: 'overdue', severity: 'high',
      title: `${overdue.length} overdue invoice${overdue.length > 1 ? 's' : ''} — ${f(amt)} outstanding`,
      detail: `Oldest is ${Math.max(...overdue.map((i) => daysBetween(i.dueDate, today)))} days past due. Following up improves cash on hand; it is not a saving.`,
      amountCents: amt, evidence: overdue.map((i) => i.id), evidenceType: 'invoice',
    });
  }

  // 5. Overdue bills (late fees risk).
  const lateBills = bills.filter((b) => ['unpaid', 'partial'].includes(b.status) && b.dueDate < today);
  if (lateBills.length) {
    const amt = lateBills.reduce((s, b) => s + (b.balanceDueCents ?? b.amountCents), 0);
    out.push({
      id: 'late-bills', kind: 'late-bills', severity: 'medium',
      title: `${lateBills.length} bill${lateBills.length > 1 ? 's' : ''} past due — ${f(amt)}`,
      detail: 'Paying on time avoids possible late fees. Check each vendor’s terms.',
      amountCents: amt, evidence: lateBills.map((b) => String(b._id)), evidenceType: 'bill',
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.amountCents - a.amountCents);
}

/**
 * 13-week cash projection. Known items (open invoices, unpaid bills) are placed by due date;
 * overdue items land in week 0 and are flagged. Run-rate is the average weekly net of the last 90 days,
 * excluding transactions linked to invoices/bills (already counted as known items).
 */
const recurrenceNext = (iso, cadence) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else {
    const months = cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12;
    const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
};

export function cashflow({ txns, invoices, bills, plannedItems = [], business, today, weeks = 13 }) {
  const opening = cashBalance(txns, business, today);
  const horizonEnd = addDays(today, weeks * 7 - 1);
  const rows = Array.from({ length: weeks }, (_, i) => ({
    week: i, start: addDays(today, i * 7), end: addDays(today, i * 7 + 6), inflows: 0, outflows: 0, items: [],
  }));
  const place = (d) => (d < today ? 0 : Math.floor(daysBetween(today, d) / 7));
  let overdueIn = 0, overdueOut = 0;
  for (const inv of invoices) {
    if (!['sent', 'partial', 'overdue'].includes(inv.displayStatus) || inv.dueDate > horizonEnd) continue;
    const w = rows[place(inv.dueDate)];
    w.inflows += inv.balanceDue;
    if (inv.dueDate < today) overdueIn += inv.balanceDue;
    w.items.push({ type: 'invoice', id: inv.id, label: `${inv.number} · ${inv.customer.name}`, amountCents: inv.balanceDue, date: inv.dueDate, overdue: inv.dueDate < today });
  }
  for (const b of bills) {
    if (!['unpaid', 'partial'].includes(b.status) || b.dueDate > horizonEnd) continue;
    const dueCents = b.balanceDueCents ?? b.amountCents;
    if (dueCents <= 0) continue;
    const w = rows[place(b.dueDate)];
    w.outflows += dueCents;
    if (b.dueDate < today) overdueOut += dueCents;
    w.items.push({ type: 'bill', id: String(b._id), label: b.vendor, amountCents: -dueCents, date: b.dueDate, overdue: b.dueDate < today });
  }
  for (const item of plannedItems) {
    // Invoiced expectations belong to the receivables ledger, avoiding a second forecast entry.
    if (item.confidence === 'invoiced') continue;
    let date = item.nextDate;
    // A due date already in the past is retained as an explicit week-one estimate, then future
    // recurrence follows from the saved cadence. No occurrence is written as a transaction.
    for (let n = 0; date && date <= horizonEnd && (!item.endDate || date <= item.endDate) && n < 100; n++) {
      if (date >= today) {
        const w = rows[place(date)], incoming = item.type === 'income';
        if (incoming) w.inflows += item.amountCents; else w.outflows += item.amountCents;
        w.items.push({ type: 'planned', id: String(item._id), label: item.name, amountCents: incoming ? item.amountCents : -item.amountCents, date, overdue: false, confidence: item.confidence, cadence: item.cadence });
      }
      if (item.cadence === 'once') break;
      const next = recurrenceNext(date, item.cadence);
      if (next <= date) break;
      date = next;
    }
  }
  const histFrom = addDays(today, -90);
  const hist = txns.filter((t) => t.date >= histFrom && t.date <= today && !t.invoiceId && !t.billId);
  const firstTxn = txns.reduce((m, t) => (t.date < m ? t.date : m), today);
  const historyDays = Math.min(90, daysBetween(firstTxn, today) + 1);
  const runRateWeekly = historyDays >= 28 ? Math.round(hist.reduce((s, t) => s + t.amountCents, 0) / historyDays * 7) : null;
  return { opening, today, hasOpeningBalance: Boolean(business.openingBalanceDate), weeks: rows, runRateWeekly, historyDays, overdueIn, overdueOut };
}

export function profitAndLoss(txns, year) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const rows = new Map();
  for (const t of txns) {
    if (!t.date.startsWith(String(year))) continue;
    const type = transactionClass(t) === 'refund' ? 'expense' : transactionClass(t);
    if (type !== 'income' && type !== 'expense') continue;
    const key = `${type}:${t.category || 'Uncategorized'}`;
    const r = rows.get(key) || { type, category: t.category || 'Uncategorized', months: new Array(12).fill(0), total: 0 };
    const i = Number(t.date.slice(5, 7)) - 1;
    const amount = type === 'expense' && transactionClass(t) === 'refund' ? -Math.abs(t.amountCents) : Math.abs(t.amountCents);
    r.months[i] += amount; r.total += amount;
    rows.set(key, r);
  }
  const list = [...rows.values()].sort((a, b) => b.total - a.total);
  return { year, months, income: list.filter((r) => r.type === 'income'), expenses: list.filter((r) => r.type === 'expense') };
}
