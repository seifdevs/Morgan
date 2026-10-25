import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Delta, ErrorBox, Icon, PageHeader, RangeSelect, Skeleton, StatusBadge } from '../../components/ui';
import { LineChart } from '../../components/charts/charts';
import { EmptyState } from '../../components/illustrations/Illustrations';
import type { Overview as OverviewData } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMonth, formatMonthYear, rangeDates, RANGES, type RangeKey } from '../../lib/dates';
import { useApi, useCountUp, useDocumentTitle, useMoney } from '../../lib/hooks';

/** A money figure that counts up to its value (instantly under reduced motion). */
function Figure({ value, className = '' }: { value: number | null; className?: string }) {
  const money = useMoney();
  const shown = useCountUp(value ?? 0);
  if (value === null) return <span className={`figure num muted ${className}`}>Unavailable</span>;
  return <span className={`figure num ${value < 0 ? 'neg' : ''} ${className}`} title={money(value)}>{money(shown)}</span>;
}

export default function Overview() {
  useDocumentTitle('Overview');
  const { business } = useAuth();
  const money = useMoney();
  const [range, setRange] = useState<RangeKey>('month');
  const { from, to } = rangeDates(range);
  const { data, error, loading, reload } = useApi<OverviewData>(`/overview?from=${from}&to=${to}`);
  const balanceAgeDays = data?.cashDetails.asOf ? Math.max(0, Math.floor((Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${data.cashDetails.asOf}T00:00:00Z`)) / 86400000)) : null;
  const rangeLabel = RANGES.find((r) => r.key === range)!.label.toLowerCase();

  const [params] = useSearchParams();
  const welcome = params.get('welcome');
  const empty = data && data.counts.transactions === 0 && data.counts.invoices === 0 && data.counts.bills === 0;
  const steps = data ? [
    { done: !!business?.openingBalanceDate, label: 'Set your opening cash balance', to: '/app/settings#business' },
    { done: data.counts.transactions > 0, label: 'Add or import transactions', to: '/app/transactions?import=1' },
    { done: data.counts.invoices > 0, label: 'Create your first invoice', to: '/app/invoices/new' },
    { done: data.counts.bills > 0, label: 'Add an upcoming bill', to: '/app/bills?new=1' },
  ] : [];

  return (
    <>
      <PageHeader
        title={business?.name || 'Overview'}
        description={`${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} · recorded activity for ${rangeLabel}, compared with the previous period of equal length.`}
        actions={<><RangeSelect value={range} onChange={setRange} /><Link className="btn outline" to="/app/transactions?new=1"><Icon name="plus" size={16} />Transaction</Link></>}
      />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && (
        <div className="ov-head" aria-busy="true"><div className="ov-cash"><Skeleton h={12} w="30%" /><Skeleton h={56} w="60%" /><Skeleton h={170} /></div><div className="ov-ledger">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={44} />)}</div></div>
      )}
      {data && (
        <>
          {data.counts.unclassified > 0 && <div className="callout info" style={{ marginBottom: 18 }}><Icon name="alert" size={16} /><span>{data.counts.unclassified} imported bank movement{data.counts.unclassified === 1 ? '' : 's'} still need financial classification. They affect recorded cash, but stay out of income and expense reports until reviewed.</span><Link className="link" to="/app/transactions">Review transactions <Icon name="arrowRight" size={14} /></Link></div>}
          {data.hasOpeningBalance && balanceAgeDays !== null && balanceAgeDays > 30 && <div className="callout info" style={{ marginBottom: 18 }}><Icon name="calendar" size={16} /><span>The latest recorded cash source is {balanceAgeDays} days old ({formatDate(data.cashDetails.asOf!)}). Import newer statements to update the view.</span></div>}
          {steps.some((s) => !s.done) && (
            <section className="panel onboard">
              <div>
                <h2>{welcome ? 'Your ledger is open.' : empty ? 'Your workspace is ready.' : 'A few steps left.'}</h2>
                <p className="onboard-count mono">{steps.filter((s) => s.done).length} of {steps.length} done</p>
                <p>Every figure in Morgan comes from records you add. Start with these — it takes a few minutes.</p>
              </div>
              <ul className="steps">
                {steps.map((s) => (
                  <li key={s.label} className={s.done ? 'done' : ''}>
                    <Link to={s.to}><span className="s-check">{s.done && <Icon name="check" size={13} />}</span><span>{s.label}</span><Icon name="arrowRight" size={16} className="arrow-r" /></Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Statement head: the cash figure and its history are one composition; the period ledger sits beside it. */}
          <section className="ov-head" aria-label="Key figures">
            <div className="ov-cash">
              <span className="folio">Cash on hand <b>recorded</b></span>
              <Figure className="ov-cash-figure" value={data.cash} />
              <p className="ov-cash-note">{data.hasOpeningBalance ? `Calculated from ${data.cashDetails.source === 'statement' ? 'statement balances' : data.cashDetails.source === 'opening-balance' ? 'dated opening balances' : 'active account balances'} and later recorded activity · as of ${data.cashDetails.asOf ? formatDate(data.cashDetails.asOf) : '—'}. Historical, not live.` : data.cashDetails.missingAccounts.length ? `A total is unavailable because these accounts have no dated balance: ${data.cashDetails.missingAccounts.join(', ')}. Known balances: ${data.cashDetails.knownBalanceCents === null ? '—' : money(data.cashDetails.knownBalanceCents)}.` : <>Cash total unavailable. <Link className="link" to="/app/settings#business">Set a dated opening balance</Link> or import a statement with its closing balance.</>}</p>
              <div className="ov-cash-chart">
                {data.balanceHistory.some((b) => b.balance !== null) ? <LineChart ariaLabel="Recorded month-end cash balance" labels={data.balanceHistory.map((b) => formatMonth(b.month))}
                  series={[{ key: 'bal', label: 'Recorded month-end balance', color: '#c9a86a', area: true, values: data.balanceHistory.map((b) => b.balance) }]}
                  format={(v) => money(v, { compact: true })} height={170} /> : <EmptyState kind="chart" title="No dated balance history yet">An opening balance or statement close gives Morgan a starting point for a historical balance view.</EmptyState>}
              </div>
            </div>
            <dl className="ov-ledger">
              <div><dt>Income</dt><dd><Figure value={data.period.income} /><Delta current={data.period.income} prior={data.prior.income} /></dd></div>
              <div><dt>Expenses</dt><dd><Figure value={data.period.expenses} /><Delta current={data.period.expenses} prior={data.prior.expenses} goodWhenUp={false} /></dd></div>
              <div className="total"><dt>Net cash flow</dt><dd><Figure value={data.period.net} /><Delta current={data.period.net} prior={data.prior.net} /></dd></div>
              <div><dt>Outstanding invoices</dt><dd><Figure value={data.receivables.outstanding} />
                {data.receivables.overdueCount ? <span className="neg delta">{money(data.receivables.overdue)} overdue</span> : <span className="muted delta">{data.receivables.count} open</span>}</dd></div>
              <p className="ov-ledger-note mono">{formatDate(data.period.from)} → {formatDate(data.period.to)} · vs prior period</p>
            </dl>
          </section>

          <section className="panel overview-plan section-gap">
            <div className="panel-head"><div><h2>Cash outlook</h2><p>Starting from recorded cash. Forecast excludes open invoices unless recorded as received.</p></div><Link className="link" to="/app/cashflow">Open cash flow <Icon name="arrowRight" size={15} /></Link></div>
            <div className="overview-plan-grid">
              <div className="overview-plan-cash">
                <span className="eyebrow">PROJECTED CASH · ESTIMATE</span>
                {data.hasOpeningBalance ? <div className="forecast-points">{[["7 days", data.financialPlan.forecast.days7], ["30 days", data.financialPlan.forecast.days30], ["90 days", data.financialPlan.forecast.days90]].map(([label, value]) => <div key={String(label)}><small>{label}</small><b className={`num ${typeof value === 'number' && value < 0 ? 'neg' : ''}`}>{typeof value === 'number' ? money(value) : '—'}</b></div>)}</div> : <p className="muted">Add a dated starting cash balance to see projected balances.</p>}
                {data.financialPlan.minimumCashCents !== null && <p className="hint">Minimum reserve set to {money(data.financialPlan.minimumCashCents)}.</p>}
              </div>
              <div className="overview-budget">
                <span className="eyebrow">MONTHLY SPENDING PLAN</span>
                {data.financialPlan.monthlyBudgetCents === null ? <><p className="muted">No monthly budget set.</p><Link className="link" to="/app/cashflow">Set a budget in cash flow</Link></> : <>
                  <div className="budget-numbers"><b className="num">{money(data.financialPlan.monthlySpend)}</b><span className="muted">of {money(data.financialPlan.monthlyBudgetCents)}</span></div>
                  <div className="budget-track"><span style={{ width: `${Math.min(100, data.financialPlan.monthlyBudgetCents ? data.financialPlan.monthlySpend / data.financialPlan.monthlyBudgetCents * 100 : 0)}%` }} /></div>
                  <p className={`hint ${data.financialPlan.monthlyRemaining !== null && data.financialPlan.monthlyRemaining < 0 ? 'neg' : ''}`}>{data.financialPlan.monthlyRemaining !== null ? `${money(Math.abs(data.financialPlan.monthlyRemaining))} ${data.financialPlan.monthlyRemaining < 0 ? 'over budget' : 'remaining'}` : 'Based on recorded transactions this month'}</p>
                </>}
              </div>
              <div className="overview-upcoming">
                <span className="eyebrow">UPCOMING EXPECTED ACTIVITY</span>
                {data.financialPlan.upcoming.length ? <ul className="list">{data.financialPlan.upcoming.slice(0, 4).map((i) => <li key={`${i.type}-${i.id}-${i.date}`}><div className="list-row"><span className="lr-main"><b>{i.label}</b><small>{formatDate(i.date)} · {i.type === 'bill' ? 'unpaid bill' : i.confidence || 'planned'}</small></span><span className={`lr-amt num ${i.amountCents > 0 ? 'pos' : ''}`}>{money(i.amountCents, { sign: true })}</span></div></li>)}</ul> : <p className="muted">No expected items are scheduled. Add a planned receipt or expense in cash flow.</p>}
              </div>
            </div>
            {data.financialPlan.minimumCashCents !== null && data.financialPlan.forecast.days90 !== null && data.financialPlan.forecast.days90 < data.financialPlan.minimumCashCents && <div className="callout" style={{ margin: '0 20px 20px' }}><Icon name="alert" size={16} /><span>Under current assumptions, projected cash falls below your minimum reserve within 90 days. Review the cash-flow assumptions and upcoming items.</span></div>}
          </section>

          <div className="grid main-side">
            <div className="stack">
            <section className="panel">
              <div className="panel-head"><h2>Recent transactions</h2><Link className="link" to="/app/transactions">View all</Link></div>
              <div style={{ paddingTop: 8 }}>
                {data.recent.length ? (
                  <div className="table-wrap"><table className="table responsive">
                    <thead><tr><th>Date</th><th>Description</th><th className="hide-sm">Category</th><th className="r">Amount</th></tr></thead>
                    <tbody>{data.recent.map((t) => (
                      <tr key={t.id}>
                        <td className="muted">{formatDate(t.date)}</td>
                        <td><b>{t.description}</b>{t.vendor && <span className="sub">{t.vendor}</span>}</td>
                        <td className="hide-sm muted">{t.category}</td>
                        <td className={`amount ${t.amountCents >= 0 ? 'pos' : ''}`}>{money(t.amountCents, { sign: true })}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                ) : <EmptyState kind="ledger" title="No transactions recorded" actions={<><Link className="btn sm primary" to="/app/transactions?new=1">Add transaction</Link><Link className="btn sm outline" to="/app/transactions?import=1">Import CSV</Link></>}>Income and expenses you add or import will be listed here.</EmptyState>}
              </div>
            </section>
            </div>
            <div className="stack">
              <section className="panel">
                <div className="panel-head"><h2>Invoices due next</h2><Link className="link" to="/app/invoices">All invoices</Link></div>
                <div style={{ paddingTop: 12 }}>
                  {data.upcomingInvoices.length ? (
                    <ul className="list">
                      {data.upcomingInvoices.map((i) => (
                        <li key={i.id}><Link className="list-row" to={`/app/invoices/${i.id}`}>
                          <span className="lr-main"><b>{i.customer.name}</b><small>{i.number} · due {formatDate(i.dueDate)}</small></span>
                          <span className="lr-amt num">{money(i.balanceDue)}<StatusBadge status={i.displayStatus} /></span>
                        </Link></li>
                      ))}
                    </ul>
                  ) : <EmptyState kind="invoice" title="Nothing outstanding" actions={<Link className="btn sm outline" to="/app/invoices/new">Create invoice</Link>}>Sent, unpaid invoices will appear here.</EmptyState>}
                </div>
              </section>
              <section className="panel">
                <div className="panel-head"><h2>Bills due in 7 days</h2><Link className="link" to="/app/bills">All bills</Link></div>
                <div style={{ paddingTop: 12 }}>
                  {data.payables.dueSoon.length ? (
                    <ul className="list">
                      {data.payables.dueSoon.map((b) => (
                        <li key={b.id} className="list-row">
                          <span className="lr-main"><b>{b.vendor}</b><small>{b.category} · due {formatDate(b.dueDate)}</small></span>
                          <span className="lr-amt num">{money(b.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted" style={{ padding: '4px 20px 20px', fontSize: 14 }}>No unpaid bills due in the next week. {data.payables.count > 0 && <>{data.payables.count} unpaid in total ({money(data.payables.outstanding)}).</>}</p>}
                </div>
              </section>
            </div>
          </div>

          <p className="chart-note">Recorded activity as of {formatMonthYear(to.slice(0, 7))}. Months without statement coverage may be incomplete. Cash outlook is a separate estimate using saved plans and unpaid bills; open invoices are not included as cash by default.</p>
        </>
      )}
    </>
  );
}
