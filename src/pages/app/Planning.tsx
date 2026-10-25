import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Icon, LoadingRows, PageHeader } from '../../components/ui';
import { ChartFrame, LineChart } from '../../components/charts/charts';
import { EmptyState } from '../../components/illustrations/Illustrations';
import type { Business, CashFlow as CashFlowData, PlannedItem, Pnl } from '../../lib/api';
import { api } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { formatDate, formatDay, formatMonth } from '../../lib/dates';
import { useApi, useDocumentTitle, useMoney } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { centsToInput, toCents } from '../../../shared/money.js';

export function CashFlow() {
  useDocumentTitle('Cash flow');
  const money = useMoney();
  const { business } = useAuth();
  const { data, error, loading, reload } = useApi<CashFlowData>('/cashflow');
  const planned = useApi<PlannedItem[]>('/planning-items');
  const { setSession } = useAuth();
  const [useRunRate, setUseRunRate] = useState(true);
  const [includeOverdue, setIncludeOverdue] = useState(true);
  const [includeReceivables, setIncludeReceivables] = useState(false);
  const [revAdj, setRevAdj] = useState('');
  const [costAdj, setCostAdj] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<PlannedItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [budgetValue, setBudgetValue] = useState(business?.monthlyBudgetCents == null ? '' : centsToInput(business.monthlyBudgetCents));
  const [reserveValue, setReserveValue] = useState(business?.minimumCashCents == null ? '' : centsToInput(business.minimumCashCents));
  const [form, setForm] = useState({ name: '', type: 'expense', category: 'Other', amount: '', cadence: 'once', nextDate: new Date().toISOString().slice(0, 10), endDate: '', confidence: 'planned', notes: '' });

  const model = useMemo(() => {
    if (!data) return null;
    // Monthly what-if adjustments spread evenly per week (12 months / 52 weeks).
    const weeklyAdj = Math.round((((toCents(revAdj || '0') ?? 0) - (toCents(costAdj || '0') ?? 0)) * 12) / 52);
    const runRate = useRunRate && data.runRateWeekly !== null ? data.runRateWeekly : 0;
    let bal = data.opening;
    const rows = data.weeks.map((w) => {
      const excludedInvoice = includeReceivables ? 0 : w.items.filter((i) => i.type === 'invoice').reduce((s, i) => s + i.amountCents, 0);
      const overdueIn = includeReceivables && !includeOverdue ? w.items.filter((i) => i.overdue && i.type === 'invoice').reduce((s, i) => s + i.amountCents, 0) : 0;
      const inflows = w.inflows - excludedInvoice - overdueIn;
      const outflows = w.outflows - (includeOverdue ? 0 : w.items.filter((i) => i.overdue && i.type === 'bill').reduce((s, i) => s - i.amountCents, 0));
      const net = inflows - outflows + runRate + weeklyAdj;
      bal += net;
      return { ...w, inflows, outflows, other: runRate + weeklyAdj, net, balance: bal };
    });
    const low = rows.reduce((m, r) => (r.balance < m.balance ? r : m), rows[0]);
    return { rows, low, runRate, weeklyAdj };
  }, [data, useRunRate, includeOverdue, includeReceivables, revAdj, costAdj]);

  function startEdit(i: PlannedItem) {
    setEditing(i); setForm({ name: i.name, type: i.type, category: i.category, amount: centsToInput(i.amountCents), cadence: i.cadence, nextDate: i.nextDate, endDate: i.endDate || '', confidence: i.confidence, notes: i.notes || '' }); setShowForm(true); setSaveError('');
  }
  async function saveItem(e: FormEvent) {
    e.preventDefault(); const amountCents = toCents(form.amount);
    if (!amountCents || amountCents < 1) { setSaveError('Enter an amount greater than zero.'); return; }
    setSaveError('');
    try {
      const body = { ...form, amountCents, endDate: form.endDate || null };
      if (editing) await api(`/planning-items/${editing.id}`, { method: 'PATCH', body }); else await api('/planning-items', { method: 'POST', body });
      setShowForm(false); setEditing(null); planned.reload(); reload();
    } catch (e) { setSaveError((e as Error).message); }
  }
  async function deleteItem(i: PlannedItem) {
    if (!window.confirm(`Delete “${i.name}” and remove its future forecast occurrences? Historical transactions will not be changed.`)) return;
    try { await api(`/planning-items/${i.id}`, { method: 'DELETE' }); planned.reload(); reload(); }
    catch (e) { setSaveError((e as Error).message); }
  }
  async function saveBudget(e: FormEvent) {
    e.preventDefault(); setSaveError('');
    const monthlyBudgetCents = budgetValue.trim() ? toCents(budgetValue) : null;
    const minimumCashCents = reserveValue.trim() ? toCents(reserveValue) : null;
    if (budgetValue.trim() && monthlyBudgetCents === null) { setSaveError('Enter a valid monthly budget.'); return; }
    if (reserveValue.trim() && minimumCashCents === null) { setSaveError('Enter a valid reserve amount.'); return; }
    try { const result = await api<{ business: Business }>('/financial-setup', { method: 'PATCH', body: { monthlyBudgetCents, minimumCashCents } }); setSession({ business: result.business }); }
    catch (e) { setSaveError((e as Error).message); }
  }

  return (
    <>
      <PageHeader eyebrow="Plan" title="Cash-flow projection"
        description="A 13-week estimate starting from your recorded cash. Known items come from open invoices and unpaid bills; everything else is an assumption you control." />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <section className="panel"><LoadingRows rows={6} /></section>}
      {planned.error && <ErrorBox message={planned.error} onRetry={planned.reload} />}
      <section className="panel section-gap">
        <div className="panel-head"><div><h2>Monthly guardrails</h2><p>Your limits, saved with the business. They do not rewrite historical transactions.</p></div><span className="badge estimate">User set</span></div>
        <form className="panel-body form-grid two" onSubmit={saveBudget}>
          <div className="field"><label htmlFor="monthly-budget">Monthly spending budget · optional</label><input className="input num" id="monthly-budget" inputMode="decimal" value={budgetValue} onChange={(e) => setBudgetValue(e.target.value)} placeholder="No budget set" /></div>
          <div className="field"><label htmlFor="minimum-reserve">Minimum cash reserve · optional</label><input className="input num" id="minimum-reserve" inputMode="decimal" value={reserveValue} onChange={(e) => setReserveValue(e.target.value)} placeholder="No minimum set" /></div>
          {saveError && <div className="form-error" role="alert">{saveError}</div>}
          <div className="row-actions" style={{ gridColumn: '1 / -1' }}><button className="btn primary" type="submit">Save guardrails</button></div>
        </form>
      </section>
      <section className="panel section-gap">
        <div className="panel-head"><div><h2>Expected cash movements</h2><p>Saved assumptions are projected only; adding one does not create a paid transaction.</p></div><button className="btn primary sm" onClick={() => { setEditing(null); setForm({ name: '', type: 'expense', category: 'Other', amount: '', cadence: 'once', nextDate: data?.today || new Date().toISOString().slice(0, 10), endDate: '', confidence: 'planned', notes: '' }); setSaveError(''); setShowForm(!showForm); }}><Icon name="plus" size={15} />Add financial item</button></div>
        {showForm && <form className="panel-body setup-form" onSubmit={saveItem}>
          <div className="form-grid two">
            <div className="field"><label htmlFor="plan-name">Name</label><input className="input" id="plan-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="plan-type">Type</label><select className="select" id="plan-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="expense">Expected expense</option><option value="income">Expected income</option></select></div>
            <div className="field"><label htmlFor="plan-category">Category</label><input className="input" id="plan-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
            <div className="field"><label htmlFor="plan-amount">Amount ({business?.currency || 'business currency'})</label><input className="input num" id="plan-amount" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="field"><label htmlFor="plan-cadence">Frequency</label><select className="select" id="plan-cadence" value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}><option value="once">One time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></div>
            <div className="field"><label htmlFor="plan-next">Next expected date</label><input className="input" id="plan-next" type="date" required value={form.nextDate} onChange={(e) => setForm({ ...form, nextDate: e.target.value })} /></div>
            <div className="field"><label htmlFor="plan-end">End date · optional</label><input className="input" id="plan-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            <div className="field"><label htmlFor="plan-confidence">Expectation</label><select className="select" id="plan-confidence" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })}><option value="planned">Planned</option><option value="estimated">Estimate</option><option value="contracted">Contracted</option><option value="invoiced">Tracked on an invoice</option></select><span className="hint">Invoice-linked expectations stay out of this schedule to avoid double-counting.</span></div>
          </div>
          {saveError && <div className="form-error" role="alert">{saveError}</div>}
          <div className="row-actions"><button type="button" className="btn ghost" onClick={() => setShowForm(false)}>Cancel</button><button className="btn primary" type="submit">{editing ? 'Save changes' : 'Save financial item'}</button></div>
        </form>}
        {planned.loading && !planned.data ? <div className="panel-body"><LoadingRows rows={3} /></div> : planned.data?.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th>Next date</th><th>Frequency</th><th className="r">Amount</th><th>Status</th><th></th></tr></thead><tbody>{planned.data.map((i) => <tr key={i.id}><td><b>{i.name}</b><span className="sub">{i.category} · {i.type === 'income' ? 'expected income' : 'expected expense'}</span></td><td>{formatDate(i.nextDate)}</td><td>{i.cadence}</td><td className={`amount ${i.type === 'income' ? 'pos' : ''}`}>{i.type === 'income' ? '+' : '−'}{money(i.amountCents)}</td><td><span className="badge estimate">{i.confidence}</span></td><td><button className="btn ghost sm" onClick={() => startEdit(i)} aria-label={`Edit ${i.name}`}><Icon name="edit" size={15} /></button><button className="btn ghost sm" onClick={() => deleteItem(i)} aria-label={`Delete ${i.name}`}><Icon name="trash" size={15} /></button></td></tr>)}</tbody></table></div> : <div className="panel-body muted">No expected cash movements saved. Add a one-time or recurring item to include it in the projection.</div>}
      </section>
      {data && model && (
        <>
          <section className="statement" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi hero-kpi"><span className="kpi-label"><span className="badge paid">{data.hasOpeningBalance ? 'Recorded estimate' : 'Incomplete'}</span></span><span className="kpi-value num">{data.hasOpeningBalance ? money(data.opening) : 'Not set'}</span><span className="kpi-foot">{data.hasOpeningBalance ? `cash as of ${formatDate(data.today)}` : 'Add an opening cash balance'}</span></div>
            <div className="kpi"><span className="kpi-label"><span className="badge estimate">Estimate</span></span><span className={`kpi-value num ${data.hasOpeningBalance && model.rows.at(-1)!.balance < 0 ? 'neg' : ''}`}>{data.hasOpeningBalance ? money(model.rows.at(-1)!.balance) : 'Incomplete'}</span><span className="kpi-foot">{data.hasOpeningBalance ? `in 13 weeks · ${formatDate(model.rows.at(-1)!.end)}` : 'Starting balance required for an absolute forecast'}</span></div>
            <div className="kpi"><span className="kpi-label"><span className="badge estimate">Lowest point</span></span><span className={`kpi-value num ${data.hasOpeningBalance && model.low.balance < 0 ? 'neg' : ''}`}>{data.hasOpeningBalance ? money(model.low.balance) : 'Incomplete'}</span><span className="kpi-foot">{data.hasOpeningBalance ? `week of ${formatDay(model.low.start)}` : 'Starting balance required'}</span></div>
            <div className="kpi"><span className="kpi-label">Scheduled net</span><span className="kpi-value num">{money(model.rows.reduce((s, w) => s + w.inflows - w.outflows, 0))}</span><span className="kpi-foot">after selected receivables assumptions</span></div>
          </section>

          {data.hasOpeningBalance && model.low.balance < 0 && <div className="callout" style={{ marginBottom: 20 }}><Icon name="alert" size={16} /><span>Under these assumptions cash falls below zero in the week of {formatDate(model.low.start)}. Review the timing of receipts and bills below.</span></div>}

          <div className="grid main-side">
            <ChartFrame title="Projected balance" aside={<span className="badge estimate">Estimate</span>}
              note={`The solid point is today's recorded balance; the dashed line is an estimate. Unpaid bills and saved plans are dated as entered${includeReceivables ? ', with open invoices assumed collected on their due dates' : '; open invoices are excluded by default'}.`}>
              {data.hasOpeningBalance ? <LineChart ariaLabel="Projected weekly cash balance" height={260}
                labels={['Today', ...model.rows.map((r) => formatDay(r.end))]}
                series={[
                  { key: 'proj', label: 'Projected balance (estimate)', color: '#b9c1c7', dashed: true, values: [data.opening, ...model.rows.map((r) => r.balance)] },
                  { key: 'rec', label: 'Recorded today', color: '#c9a86a', values: [data.opening, ...model.rows.map(() => null)] },
                ]}
                format={(v) => money(v, { compact: true })} markIndex={0} /> : <EmptyState kind="chart" title="Starting cash is needed for a balance forecast" actions={<Link className="btn sm outline" to="/app/settings#business">Set opening balance</Link>}>Expected money in and out is listed below, but Morgan will not draw a cash balance from an assumed zero.</EmptyState>}
            </ChartFrame>
            <section className="panel">
              <div className="panel-head"><h2>Assumptions</h2></div>
              <div className="panel-body form-grid">
                <label className="checkbox"><input type="checkbox" checked={useRunRate} disabled={data.runRateWeekly === null} onChange={(e) => setUseRunRate(e.target.checked)} />
                  <span>Include recent run-rate {data.runRateWeekly !== null ? <b className="num">({money(data.runRateWeekly, { sign: true })}/week)</b> : <span className="muted">(needs 4+ weeks of history)</span>}</span></label>
                <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>Average weekly net of the last {Math.min(90, data.historyDays)} days of transactions, excluding invoice and bill payments (already counted as known items).</p>
                <label className="checkbox"><input type="checkbox" checked={includeOverdue} onChange={(e) => setIncludeOverdue(e.target.checked)} />
                  <span>Count overdue items in week 1 <span className="muted">({money(data.overdueIn)} in · {money(data.overdueOut)} out)</span></span></label>
                <label className="checkbox"><input type="checkbox" checked={includeReceivables} onChange={(e) => setIncludeReceivables(e.target.checked)} />
                  <span>Assume open invoices are collected on due date</span></label>
                <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>Off by default. Invoice amounts are receivables, not cash; this assumption only affects the estimate.</p>
                <div className="form-grid two">
                  <div className="field"><label htmlFor="rev">Extra revenue / month</label><input className="input num" id="rev" inputMode="decimal" value={revAdj} onChange={(e) => setRevAdj(e.target.value)} placeholder="0.00" /></div>
                  <div className="field"><label htmlFor="cost">Extra costs / month</label><input className="input num" id="cost" inputMode="decimal" value={costAdj} onChange={(e) => setCostAdj(e.target.value)} placeholder="0.00" /></div>
                </div>
                <p className="muted" style={{ fontSize: 12.5 }}>What-if adjustments (e.g. a new hire or client) apply only to this view and are never saved to your records.</p>
              </div>
            </section>
          </div>

          <section className="panel section-gap">
            <div className="panel-head"><h2>Week by week</h2><span className="muted" style={{ fontSize: 12.5 }}>Select a week to see its items</span></div>
            <div className="table-wrap" style={{ paddingTop: 8 }}><table className="table">
              <thead><tr><th>Week</th><th className="r">Expected in</th><th className="r">Expected out</th><th className="r">Assumed</th><th className="r">Balance</th></tr></thead>
              <tbody>{model.rows.map((r) => (
                <Fragment key={r.week}>
                  <tr className="clickable" onClick={() => setOpen(open === r.week ? null : r.week)} aria-expanded={open === r.week}>
                    <td><b>{formatDay(r.start)} – {formatDay(r.end)}</b><span className="sub">{r.items.length} known item{r.items.length === 1 ? '' : 's'}</span></td>
                    <td className="amount pos">{r.inflows ? money(r.inflows) : '—'}</td>
                    <td className="amount">{r.outflows ? money(-r.outflows) : '—'}</td>
                    <td className="amount muted">{r.other ? money(r.other, { sign: true }) : '—'}</td>
                    <td className={`amount ${data.hasOpeningBalance && r.balance < 0 ? 'neg' : ''}`}>{data.hasOpeningBalance ? money(r.balance) : '—'}</td>
                  </tr>
                  {open === r.week && (
                    <tr><td colSpan={5} style={{ background: '#ffffff03' }}>
                      {r.items.length ? <ul className="week-items">{r.items.map((it) => (
                        <li key={it.type + it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          {it.type === 'invoice' ? <Link className="link" to={`/app/invoices/${it.id}`}>{it.label}</Link> : it.type === 'bill' ? <Link className="link" to="/app/bills">{it.label}</Link> : <span>{it.label} <span className="badge estimate">{it.confidence || 'planned'}</span></span>}
                          <span>{formatDate(it.date)}{it.overdue && <span className="neg"> · overdue</span>}{it.type === 'invoice' && !includeReceivables && <span className="muted"> · excluded from estimate</span>} · <b className="num">{money(it.amountCents, { sign: true })}</b></span>
                        </li>
                      ))}</ul> : <span className="muted" style={{ fontSize: 13 }}>No invoices or bills due this week.</span>}
                    </td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table></div>
          </section>
          {!data.weeks.some((w) => w.items.length) && data.runRateWeekly === null && (
            <section className="panel section-gap"><EmptyState kind="chart" title="Not much to project yet" actions={<><Link className="btn sm primary" to="/app/invoices/new">Create invoice</Link><Link className="btn sm outline" to="/app/bills?new=1">Add bill</Link></>}>Open invoices, unpaid bills and a few weeks of transactions make this projection meaningful.</EmptyState></section>
          )}
        </>
      )}
    </>
  );
}

export function Reports() {
  useDocumentTitle('Reports');
  const money = useMoney();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, error, loading, reload } = useApi<Pnl>(`/reports/pnl?year=${year}`);
  const sumMonths = (rows: Pnl['income']) => Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r.months[i], 0));
  const inc = data ? sumMonths(data.income) : [], exp = data ? sumMonths(data.expenses) : [];
  const net = inc.map((v, i) => v - exp[i]);
  const total = (a: number[]) => a.reduce((s, v) => s + v, 0);

  function exportCsv() {
    if (!data) return;
    const head = ['Category', ...data.months.map(formatMonth), 'Total'];
    const line = (label: string, vals: number[], t: number) => [label, ...vals.map(centsToInput), centsToInput(t)];
    downloadCsv(`morgan-profit-and-loss-${year}.csv`, [
      head, ['Income'], ...data.income.map((r) => line(r.category, r.months, r.total)), line('Total income', inc, total(inc)),
      ['Expenses'], ...data.expenses.map((r) => line(r.category, r.months, r.total)), line('Total expenses', exp, total(exp)),
      line('Net', net, total(net)),
    ]);
  }

  const Row = ({ label, vals, t, strong, cls = '' }: { label: string; vals: number[]; t: number; strong?: boolean; cls?: string }) => (
    <tr style={strong ? { background: '#ffffff04' } : undefined}>
      <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', fontWeight: strong ? 700 : 500, whiteSpace: 'nowrap' }}>{label}</td>
      {vals.map((v, i) => <td key={i} className={`amount ${cls} ${!v ? 'muted' : ''}`} style={{ fontWeight: strong ? 700 : 500 }}>{v ? money(v, { compact: Math.abs(v) >= 1e7 }) : '—'}</td>)}
      <td className={`amount ${cls}`} style={{ fontWeight: 700 }}>{money(t)}</td>
    </tr>
  );

  return (
    <>
      <PageHeader eyebrow="Plan" title="Profit & loss" description="Monthly income and expenses by category, from recorded transactions (cash basis)."
        actions={<>
          <select className="select" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto' }}>{[0, 1, 2, 3].map((i) => <option key={i}>{thisYear - i}</option>)}</select>
          <button className="btn outline" onClick={exportCsv} disabled={!data || (!data.income.length && !data.expenses.length)}><Icon name="download" size={16} />Export CSV</button>
        </>} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <section className="panel"><LoadingRows rows={8} /></section>}
      {data && (data.income.length || data.expenses.length ? (
        <>
          <section className="statement" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="kpi"><span className="kpi-label">Income {year}</span><span className="kpi-value num">{money(total(inc))}</span></div>
            <div className="kpi"><span className="kpi-label">Expenses {year}</span><span className="kpi-value num">{money(total(exp))}</span></div>
            <div className="kpi hero-kpi"><span className="kpi-label">Net {year}</span><span className={`kpi-value num ${total(net) < 0 ? 'neg' : ''}`}>{money(total(net))}</span><span className="kpi-foot">{total(inc) ? `${((total(net) / total(inc)) * 100).toFixed(1)}% margin` : ''}</span></div>
          </section>
          <section className="panel">
            <div className="table-wrap"><table className="table dense" style={{ minWidth: 980 }}>
              <thead><tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>Category</th>{data.months.map((m) => <th key={m} className="r">{formatMonth(m)}</th>)}<th className="r">Total</th></tr></thead>
              <tbody>
                <tr><td colSpan={14} className="eyebrow gold" style={{ paddingTop: 18 }}>Income</td></tr>
                {data.income.map((r) => <Row key={r.category} label={r.category} vals={r.months} t={r.total} />)}
                <Row label="Total income" vals={inc} t={total(inc)} strong />
                <tr><td colSpan={14} className="eyebrow gold" style={{ paddingTop: 18 }}>Expenses</td></tr>
                {data.expenses.map((r) => <Row key={r.category} label={r.category} vals={r.months} t={r.total} />)}
                <Row label="Total expenses" vals={exp} t={total(exp)} strong />
                <Row label="Net" vals={net} t={total(net)} strong />
              </tbody>
            </table></div>
          </section>
        </>
      ) : <section className="panel"><EmptyState kind="chart" title={`No transactions in ${year}`} actions={<Link className="btn sm primary" to="/app/transactions?import=1">Import transactions</Link>}>Reports are built from recorded income and expense transactions.</EmptyState></section>)}
    </>
  );
}
