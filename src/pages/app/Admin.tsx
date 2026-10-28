import { Icon, LoadingRows, PageHeader } from '../../components/ui';
import { useApi, useDocumentTitle } from '../../lib/hooks';

type AdminOverview = { users: number; businesses: number; transactions: number; invoices: number; bills: number; statementImports: number };
type EmailPreviews = { enabled: boolean; items: { id: string; kind: string; to: string; intendedRecipient: string; subject: string; text: string; createdAt: string }[] };
const metrics: { key: keyof AdminOverview; label: string }[] = [
  { key: 'users', label: 'Accounts' }, { key: 'businesses', label: 'Businesses' },
  { key: 'transactions', label: 'Transactions' }, { key: 'invoices', label: 'Invoices' },
  { key: 'bills', label: 'Bills' }, { key: 'statementImports', label: 'Statement imports' },
];

export default function Admin() {
  useDocumentTitle('Administration');
  const data = useApi<AdminOverview>('/admin/overview');
  const previews = useApi<EmailPreviews>('/admin/email-previews');
  return <>
    <PageHeader eyebrow="Morgan operations" title="Administration" description="Workspace-wide service totals. Access is checked by the server for every request." />
    {data.loading ? <div className="panel"><LoadingRows rows={3} /></div> : data.error ? <div className="form-error" role="alert">{data.error}</div> : <div className="admin-metrics">{metrics.map(({ key, label }) => <article className="panel admin-metric" key={key}><span className="muted">{label}</span><strong>{data.data?.[key] ?? 0}</strong></article>)}</div>}
    {previews.data?.enabled && <section className="panel" style={{ margin: '22px 0', padding: 20 }}><h2>Local email preview</h2><p className="muted">Development only. These messages contain active verification or reset links and are visible to administrators in this local environment.</p>{previews.data.items.length ? <div className="form-grid">{previews.data.items.map((item) => <article key={item.id} className="panel" style={{ padding: 16 }}><b>{item.subject}</b><p className="muted">{item.kind.replace('_', ' ')} · sent to {item.to}{item.intendedRecipient !== item.to ? ` (intended for ${item.intendedRecipient})` : ''} · {new Date(item.createdAt).toLocaleString()}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', fontSize: 13 }}>{item.text}</pre></article>)}</div> : <p className="muted">Verification and password-reset messages will appear here when requested.</p>}</section>}
    <div className="callout"><Icon name="lock" size={16} /><span>Administrator privileges come from the user role stored in Morgan’s database. Hiding this page in the interface is not the security boundary.</span></div>
  </>;
}
