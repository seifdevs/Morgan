import { Link } from 'react-router-dom';
import { Icon, PageHeader } from '../../components/ui';
import { useApi, useDocumentTitle } from '../../lib/hooks';

type UsageData = {
  plan: { name: string; id: string };
  period: { month: string; resetsAt: string; timezone: 'UTC' };
  usage: Record<'financialRecords'|'intelligenceRequests'|'pdfReports', { used: number; limit: number; remaining: number }>;
  capabilities: { workspaces: { used: number; limit: number }; seats: { used: number; limit: number }; scenariosPerWorkspace: { used: number; limit: number }; forecastDays: number; monitor: string };
  paymentConfigured: boolean;
};
const metrics = [
  ['financialRecords', 'Financial records', 'Transactions, invoices, bills, planned entries, and imported statement rows'],
  ['intelligenceRequests', 'Morgan Intelligence', 'Completed customer requested responses'],
  ['pdfReports', 'PDF reports', 'Newly generated financial reports'],
] as const;
const monthLabel = (month: string) => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00.000Z`));
const resetLabel = (date: string) => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(date));

export default function Usage() {
  useDocumentTitle('Plan & usage');
  const { data, error, loading } = useApi<UsageData>('/usage');
  return <>
    <PageHeader eyebrow="Account / Allowances" title="Plan & usage" description="Monthly limits follow UTC calendar months and reset at midnight on the first day." />
    {loading && !data && <section className="panel panel-body">Loading your current plan and usage…</section>}
    {error && <section className="panel panel-body" role="alert">{error}</section>}
    {data && <>
      <section className="panel usage-plan"><div><span className="kpi-label">Current plan</span><h2>{data.plan.name}</h2><p className="muted">{data.paymentConfigured ? 'Subscription status is managed by the configured billing provider.' : 'Free forever · no payment method or trial.'}</p></div><span className="badge paid">Active</span></section>
      <section className="usage-grid">{metrics.map(([key, title, description]) => {
        const item = data.usage[key], percent = Math.min(100, item.used / item.limit * 100);
        return <article className="panel usage-card" key={key}><div className="usage-card-head"><div><h2>{title}</h2><p>{description}</p></div><b className="num">{item.used.toLocaleString()} <span>/ {item.limit.toLocaleString()}</span></b></div><div className="usage-track" role="progressbar" aria-label={`${title} used`} aria-valuemin={0} aria-valuemax={item.limit} aria-valuenow={item.used}><span style={{ width: `${percent}%` }} /></div><small>{item.remaining.toLocaleString()} remaining this month</small></article>;
      })}</section>
      <section className="panel usage-period"><div><h2>{monthLabel(data.period.month)} allowance</h2><p>Usage resets at {resetLabel(data.period.resetsAt)} UTC. Annual plans receive the same monthly allowance.</p></div><div className="usage-capabilities"><span>{data.capabilities.workspaces.used} of {data.capabilities.workspaces.limit} workspace</span><span>{data.capabilities.seats.used} of {data.capabilities.seats.limit} seat</span><span>{data.capabilities.scenariosPerWorkspace.used} of {data.capabilities.scenariosPerWorkspace.limit} saved scenarios</span><span>{data.capabilities.forecastDays}-day Horizon</span><span>Monitor: {data.capabilities.monitor}</span></div></section>
      {!data.paymentConfigured && <section className="callout info"><Icon name="alert" size={16} /><span>Pro and Max have published prices, but paid checkout is not configured on this server. Your usage allowance cannot be upgraded here yet.</span><Link className="link" to="/pricing">Review plans</Link></section>}
    </>}
  </>;
}
