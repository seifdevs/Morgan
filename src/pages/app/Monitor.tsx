import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Icon, LoadingRows, PageHeader } from '../../components/ui';
import { EmptyState } from '../../components/illustrations/Illustrations';
import type { Insight, Txn } from '../../lib/api';
import { useApi, useDocumentTitle, useMoney } from '../../lib/hooks';

type Data = { insights: Insight[]; transactions: Txn[]; recurring: { vendor: string; typicalMonthly: number; annualized: number; months: number; lastDate: string }[] };
const iconFor: Record<string, string> = { overdue: 'alert', 'late-bills': 'payable', recurring: 'calendar', 'price-increase': 'trend', 'vendor-increase': 'receivable', duplicate: 'layers', 'unusual-expense': 'alert', 'cash-shortage': 'cash' };

export default function Monitor() {
  useDocumentTitle('Monitor');
  const money = useMoney();
  const { data, error, loading, reload } = useApi<Data>('/insights');
  const usage = useApi<{ capabilities: { monitor: string } }>('/usage');
  const fullMonitor = usage.data?.capabilities.monitor === 'full';
  const [level, setLevel] = useState('all');
  const visible = useMemo(() => (data?.insights || []).filter((item) => level === 'all' || item.severity === level), [data, level]);
  function href(item: Insight) {
    if (item.kind === 'cash-shortage') return '/app/horizon';
    if (item.evidenceType === 'invoice' || item.kind === 'overdue') return '/app/receivables';
    if (item.evidenceType === 'bill' || item.kind === 'late-bills') return '/app/bills';
    return '/app/transactions';
  }
  return <>
    <PageHeader eyebrow="Monitor" title="Items to review" description={fullMonitor ? 'Full Monitor includes overdue items, duplicates, spending changes, recurring patterns and forecast pressure.' : 'Monitor Core highlights overdue invoices, late bills, possible duplicates and forecast reserve pressure.'} actions={<select className="select" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Alert severity"><option value="all">All alerts</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Lower priority</option></select>} />
    {usage.data && !fullMonitor && <div className="callout info"><Icon name="alert" size={16}/><span>Starter includes Monitor Core. Pro and Max include full spending trend and recurring-cost findings.</span><Link className="link" to="/app/usage">Review plans</Link></div>}
    {error && <ErrorBox message={error} onRetry={reload} />}
    {loading && !data && <section className="panel"><LoadingRows rows={5} /></section>}
    {data && <>
      <section className="statement monitor-summary" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kpi"><span className="kpi-label">Needs attention</span><span className="kpi-value num">{data.insights.filter((i) => i.severity === 'high').length}</span><span className="kpi-foot">high priority alerts</span></div>
        <div className="kpi"><span className="kpi-label">Open invoices</span><span className="kpi-value num">{data.insights.filter((i) => i.kind === 'overdue').length ? 'Overdue' : 'On track'}</span><span className="kpi-foot">based on invoice due dates</span></div>
        <div className="kpi"><span className="kpi-label">Recurring costs found</span><span className="kpi-value num">{data.recurring.length}</span><span className="kpi-foot">matching charges in recent records</span></div>
      </section>
      <div className="monitor-list section-gap">{visible.length ? visible.map((item) => <article className="panel monitor-alert" key={item.id}>
        <div className="monitor-alert-icon"><Icon name={iconFor[item.kind] || 'alert'} size={18} /></div>
        <div className="monitor-alert-copy"><div className="monitor-alert-title"><h2>{item.title}</h2><span className={`badge ${item.severity === 'high' ? 'overdue' : item.severity === 'medium' ? 'partial' : 'estimate'}`}>{item.severity}</span></div><p>{item.detail}</p>
          <div className="monitor-evidence">{item.evidence.length ? <span>{item.evidence.length} linked record{item.evidence.length === 1 ? '' : 's'}</span> : <span>Forecast estimate</span>}<span className="num">{money(item.amountCents, { sign: item.amountCents < 0 })}</span></div>
          <Link className="link" to={href(item)}>Review supporting records <Icon name="arrowRight" size={14} /></Link>
        </div>
      </article>) : <section className="panel"><EmptyState kind="insight" title={data.insights.length ? 'No alerts at this severity' : 'No alerts to review'}>{fullMonitor ? 'Morgan checks records for late obligations, duplicates, unusual charges, vendor spending increases, recurring price changes and projected reserve pressure.' : 'Monitor Core checks records for overdue invoices, late bills, possible duplicates and projected reserve pressure.'}</EmptyState></section>}</div>
      {data.recurring.length > 0 && <section className="panel section-gap"><div className="panel-head"><div><h2>Detected recurring expenses</h2><p>These are pattern matches in recorded transactions, not subscriptions confirmed by the vendor.</p></div></div><div className="table-wrap"><table className="table"><thead><tr><th>Vendor</th><th>Months seen</th><th className="r">Typical monthly</th><th className="r">Annualised at current rate</th><th>Last seen</th></tr></thead><tbody>{data.recurring.map((row) => <tr key={row.vendor}><td><b>{row.vendor}</b></td><td>{row.months}</td><td className="amount">{money(row.typicalMonthly)}</td><td className="amount">{money(row.annualized)}</td><td>{row.lastDate}</td></tr>)}</tbody></table></div></section>}
    </>}
  </>;
}
