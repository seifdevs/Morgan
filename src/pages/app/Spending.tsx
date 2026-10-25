import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Delta, ErrorBox, Icon, LoadingRows, PageHeader, RangeSelect, useToast , Marker } from '../../components/ui';
import { BreakdownList, ChartFrame, LineChart } from '../../components/charts/charts';
import { EmptyState } from '../../components/illustrations/Illustrations';
import { api, type Insight, type Spending as SpendingData, type Txn } from '../../lib/api';
import { addDaysISO, formatDate, formatDay, rangeDates, type RangeKey } from '../../lib/dates';
import { useApi, useDocumentTitle, useMoney } from '../../lib/hooks';

export default function Spending() {
  useDocumentTitle('Spending');
  const money = useMoney();
  const [range, setRange] = useState<RangeKey>('30d');
  const [dim, setDim] = useState<'category' | 'vendor'>('category');
  const [selected, setSelected] = useState<string | null>(null);
  const { from, to } = rangeDates(range);
  const { data, error, loading, reload } = useApi<SpendingData>(`/spending?from=${from}&to=${to}`);
  const drill = useApi<{ items: Txn[]; total: number; expenses: number }>(selected ? `/transactions?type=expense&from=${from}&to=${to}&${dim}=${encodeURIComponent(selected)}&limit=100` : null);

  const rows = data ? (dim === 'category' ? data.byCategory : data.byVendor) : [];
  const avgDaily = data ? Math.round(data.total / Math.max(1, data.cumulative.length)) : 0;

  return (
    <>
      <PageHeader eyebrow="Analyze" title="Spending" description="Where money went in the selected period, compared with the period of equal length just before it."
        actions={<RangeSelect value={range} onChange={(r) => { setRange(r); setSelected(null); }} />} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <section className="panel"><LoadingRows rows={6} /></section>}
      {data?.plannedRecurring.length ? <section className="panel section-gap planned-spend">
        <div className="panel-head"><div><h2>Recurring spending plan</h2><p>Future estimates from your cash-flow schedules. These are separate from recorded spending below.</p></div><Link className="link" to="/app/cashflow">Edit plan <Icon name="arrowRight" size={15} /></Link></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Expected expense</th><th>Next date</th><th>Frequency</th><th className="r">Per occurrence</th><th className="r">Monthly equivalent</th></tr></thead><tbody>{data.plannedRecurring.map((i) => <tr key={i.id}><td><b>{i.name}</b><span className="sub">{i.category} · estimate</span></td><td>{formatDate(i.nextDate)}</td><td>{i.cadence}</td><td className="amount">{money(i.amountCents)}</td><td className="amount">{money(i.monthlyEstimateCents)}</td></tr>)}</tbody></table></div>
      </section> : null}
      {data && (data.total === 0 && data.priorTotal === 0 ? (
        <section className="panel"><EmptyState kind="chart" title="No expenses in this period" actions={<Link className="btn sm primary" to="/app/transactions?import=1">Import transactions</Link>}>Choose a longer period or add expense transactions.</EmptyState></section>
      ) : (
        <>
          <section className="statement" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi hero-kpi"><span className="kpi-label">Total spent</span><span className="kpi-value num">{money(data.total)}</span><span className="kpi-foot"><Delta current={data.total} prior={data.priorTotal} goodWhenUp={false} /> vs {money(data.priorTotal)} prior</span></div>
            <div className="kpi"><span className="kpi-label">Transactions</span><span className="kpi-value num">{data.count}</span><span className="kpi-foot">{formatDate(data.from)} – {formatDate(data.to)}</span></div>
            <div className="kpi"><span className="kpi-label">Average per day</span><span className="kpi-value num">{money(avgDaily)}</span><span className="kpi-foot">over {data.cumulative.length} days</span></div>
            <div className="kpi"><span className="kpi-label">Largest category</span><span className="kpi-value" style={{ fontSize: 20 }}>{data.byCategory[0]?.amount ? data.byCategory[0].name : '—'}</span><span className="kpi-foot num">{data.byCategory[0]?.amount ? money(data.byCategory[0].amount) : ''}</span></div>
          </section>

          <div className="grid main-side">
            <ChartFrame title="Cumulative spend" aside={<span className="muted" style={{ fontSize: 12.5 }}>This period vs prior</span>}>
              <LineChart ariaLabel="Cumulative spending this period versus prior period"
                labels={data.cumulative.map((c) => formatDay(addDaysISO(data.from, c.day)))}
                series={[
                  { key: 'cur', label: 'This period', color: '#c9a86a', area: true, values: data.cumulative.map((c) => c.current) },
                  { key: 'prior', label: `Prior (${formatDate(data.prior.from)} – ${formatDate(data.prior.to)})`, color: '#6b7a89', values: data.cumulative.map((c) => c.prior) },
                ]}
                format={(v) => money(v, { compact: true })} />
            </ChartFrame>
            <section className="panel">
              <div className="panel-head">
                <h2>Breakdown</h2>
                <div className="segmented" role="group" aria-label="Group by">
                  <button aria-pressed={dim === 'category'} onClick={() => { setDim('category'); setSelected(null); }}>{dim === 'category' && <Marker id="dim-seg" className="seg-marker" />}Category</button>
                  <button aria-pressed={dim === 'vendor'} onClick={() => { setDim('vendor'); setSelected(null); }}>{dim === 'vendor' && <Marker id="dim-seg" className="seg-marker" />}Vendor</button>
                </div>
              </div>
              <div className="panel-body">
                <BreakdownList rows={rows} total={data.total} format={money} selected={selected || undefined} onSelect={(n) => setSelected(selected === n ? null : n)} />
                <p className="chart-note">Tick marks show the prior period. Select a row to see its transactions.</p>
              </div>
            </section>
          </div>

          {selected && (
            <section className="panel section-gap">
              <div className="panel-head"><h2>{selected} <span className="muted" style={{ fontWeight: 500 }}>· {formatDate(from)} – {formatDate(to)}</span></h2>
                <span style={{ display: 'flex', gap: 8 }}>
                  <Link className="btn sm outline" to={`/app/transactions?type=expense&from=${from}&to=${to}&${dim}=${encodeURIComponent(selected)}`}>Open in Transactions</Link>
                  <button className="btn sm ghost" onClick={() => setSelected(null)} aria-label="Close drill-down"><Icon name="close" size={15} /></button>
                </span>
              </div>
              <div style={{ paddingTop: 8 }}>
                {drill.loading ? <LoadingRows rows={3} /> : drill.data && (
                  <div className="table-wrap"><table className="table responsive">
                    <thead><tr><th>Date</th><th>Description</th><th className="hide-sm">{dim === 'category' ? 'Vendor' : 'Category'}</th><th className="r">Amount</th></tr></thead>
                    <tbody>{drill.data.items.map((t) => (
                      <tr key={t.id}><td className="muted">{formatDate(t.date)}</td><td><b>{t.description}</b></td><td className="hide-sm muted">{dim === 'category' ? t.vendor || '—' : t.category}</td><td className="amount">{money(-t.amountCents)}</td></tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={3}>{drill.data.total} transactions</td><td className="amount">{money(drill.data.expenses)}</td></tr></tfoot>
                  </table></div>
                )}
              </div>
            </section>
          )}
        </>
      ))}
    </>
  );
}

type InsightsData = { insights: Insight[]; transactions: Txn[]; recurring: { vendor: string; typicalMonthly: number; annualized: number; months: number; lastDate: string }[] };

export function Insights() {
  useDocumentTitle('Cost insights');
  const money = useMoney();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<InsightsData>('/insights');
  const byId = new Map((data?.transactions || []).map((t) => [t.id, t]));
  const icon = { duplicate: 'layers', 'price-increase': 'trend', recurring: 'calendar', 'vendor-increase': 'receivable', overdue: 'alert', 'late-bills': 'payable' } as Record<string, string>;
  const totalRecurring = (data?.recurring || []).reduce((s, r) => s + r.annualized, 0);

  async function deleteTxn(id: string) {
    try { await api(`/transactions/${id}`, { method: 'DELETE' }); toast('Duplicate removed from your records'); reload(); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <>
      <PageHeader eyebrow="Analyze" title="Cost insights" description="Patterns found in your recorded transactions, invoices and bills. Every insight lists the records behind it — Morgan does not estimate savings it cannot show." />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <section className="panel"><LoadingRows rows={6} /></section>}
      {data && (
        <div className="grid main-side">
          <section className="panel">
            <div className="panel-head"><h2>Findings</h2><span className="muted" style={{ fontSize: 13 }}>{data.insights.length} found</span></div>
            <div style={{ paddingTop: 10 }}>
              {data.insights.length ? data.insights.map((ins) => (
                <article key={ins.id} className="insight">
                  <span className={`sev ${ins.severity}`}><Icon name={icon[ins.kind] || 'spark'} size={17} /></span>
                  <div><h3>{ins.title}</h3><p>{ins.detail}</p></div>
                  <span className="amt num">{money(ins.amountCents)}<br /><small className="muted" style={{ fontWeight: 500, fontSize: 11.5 }}>{ins.kind === 'recurring' ? 'per year at current rate' : ins.kind === 'overdue' ? 'outstanding' : ins.kind === 'duplicate' ? 'if duplicate' : ins.kind === 'late-bills' ? 'past due' : 'increase'}</small></span>
                  <div className="evidence">
                    {ins.evidenceType === 'transaction' ? (
                      <details>
                        <summary>Show {ins.evidence.length} transaction{ins.evidence.length > 1 ? 's' : ''}</summary>
                        <div className="table-wrap"><table className="table"><tbody>
                          {ins.evidence.map((id) => byId.get(id)).filter(Boolean).map((t) => (
                            <tr key={t!.id}><td className="muted">{formatDate(t!.date)}</td><td>{t!.description}</td><td className="amount">{money(t!.amountCents)}</td>
                              {ins.kind === 'duplicate' && <td className="r"><button className="btn sm danger" onClick={() => deleteTxn(t!.id)} disabled={!!t!.invoiceId || !!t!.billId}>Delete this one</button></td>}
                            </tr>
                          ))}
                        </tbody></table></div>
                      </details>
                    ) : <Link className="link" style={{ fontSize: 13 }} to={ins.evidenceType === 'invoice' ? '/app/receivables' : '/app/bills'}>Review {ins.evidence.length} {ins.evidenceType}{ins.evidence.length > 1 ? 's' : ''} →</Link>}
                  </div>
                </article>
              )) : <EmptyState kind="insight" title="Nothing flagged right now">As you record more transactions, Morgan looks for duplicates, recurring costs, price increases and spending spikes.</EmptyState>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Recurring costs</h2></div>
            <div className="panel-body">
              {data.recurring.length ? (
                <>
                  <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>Vendors charged in 3+ of the last 6 months at a steady amount. Annualised at the typical monthly charge.</p>
                  <ul className="list">
                    {data.recurring.map((r) => (
                      <li key={r.vendor} className="list-row" style={{ padding: '10px 0' }}>
                        <span className="lr-main"><b>{r.vendor}</b><small>{money(r.typicalMonthly)}/mo · {r.months} months · last {formatDate(r.lastDate)}</small></span>
                        <span className="lr-amt num">{money(r.annualized)}<small className="muted" style={{ fontWeight: 500 }}>/yr</small></span>
                      </li>
                    ))}
                  </ul>
                  <div className="facts" style={{ marginTop: 8 }}><div><dt>Total recurring, annualised</dt><dd className="num">{money(totalRecurring)}</dd></div></div>
                </>
              ) : <EmptyState kind="chart" title="No recurring charges detected">Needs at least three months of expense history with a vendor name.</EmptyState>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
