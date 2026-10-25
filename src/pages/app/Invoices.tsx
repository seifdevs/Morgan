import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorBox, Icon, LoadingRows, Modal, PageHeader, StatusBadge, useToast , Marker } from '../../components/ui';
import { EmptyState } from '../../components/illustrations/Illustrations';
import { api, type Business, type Customer, type Invoice, type InvoiceStatus, type LineItem } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDaysISO, daysBetween, formatDate, todayISO } from '../../lib/dates';
import { useApi, useDocumentTitle, useMoney } from '../../lib/hooks';
import { centsToInput, invoiceTotals, lineTotalCents, toCents } from '../../../shared/money.js';
import { CustomerForm } from './Billing';

const TABS: { key: 'all' | InvoiceStatus; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'draft', label: 'Drafts' }, { key: 'sent', label: 'Sent' }, { key: 'partial', label: 'Partially paid' },
  { key: 'overdue', label: 'Overdue' }, { key: 'paid', label: 'Paid' }, { key: 'void', label: 'Void' },
];

export default function Invoices() {
  useDocumentTitle('Invoices');
  const money = useMoney();
  const nav = useNavigate();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi<Invoice[]>('/invoices');
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length || 0 };
    data?.forEach((i) => { c[i.displayStatus] = (c[i.displayStatus] || 0) + 1; });
    return c;
  }, [data]);
  const shown = (data || []).filter((i) => (tab === 'all' || i.displayStatus === tab) && (!q || `${i.number} ${i.customer.name}`.toLowerCase().includes(q.toLowerCase())));
  const open = (data || []).filter((i) => ['sent', 'partial', 'overdue'].includes(i.displayStatus));
  const sum = (l: Invoice[], k: 'balanceDue' | 'amountPaid') => l.reduce((s, i) => s + i[k], 0);

  return (
    <>
      <PageHeader eyebrow="Billing" title="Invoices" description="Create, send and track invoices. Totals are calculated in exact cents on the server."
        actions={<Link className="btn primary" to="/app/invoices/new"><Icon name="plus" size={16} />New invoice</Link>} />
      {data && data.length > 0 && (
        <section className="statement" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="kpi hero-kpi"><span className="kpi-label">Outstanding</span><span className="kpi-value num">{money(sum(open, 'balanceDue'))}</span><span className="kpi-foot">{open.length} open invoice{open.length === 1 ? '' : 's'}</span></div>
          <div className="kpi"><span className="kpi-label">Overdue</span><span className={`kpi-value num ${counts.overdue ? 'neg' : ''}`}>{money(sum(open.filter((i) => i.displayStatus === 'overdue'), 'balanceDue'))}</span><span className="kpi-foot">{counts.overdue || 0} invoice{counts.overdue === 1 ? '' : 's'}</span></div>
          <div className="kpi"><span className="kpi-label">Collected (all time)</span><span className="kpi-value num">{money(sum(data, 'amountPaid'))}</span><span className="kpi-foot">recorded payments</span></div>
        </section>
      )}
      <section className="panel">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (counts[t.key] || t.key === 'all') ? (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}<span className="count">{counts[t.key] || 0}</span>{tab === t.key && <Marker id="inv-tab" className="tab-ul" />}</button>
          ) : null)}
        </div>
        {data && data.length > 0 && (
          <div className="toolbar"><label className="search"><Icon name="search" size={16} /><span className="sr-only">Search invoices</span><input className="input" type="search" placeholder="Search number or customer" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
        )}
        {error && <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={reload} /></div>}
        {loading && !data && <LoadingRows />}
        {data && (shown.length ? (
          <div className="table-wrap"><table className="table responsive">
            <thead><tr><th>Invoice</th><th className="hide-sm">Issued</th><th className="hide-sm">Due</th><th className="hide-sm">Status</th><th className="r">Total</th><th className="r hide-sm">Balance</th></tr></thead>
            <tbody>{shown.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => nav(`/app/invoices/${i.id}`)}>
                <td><Link to={`/app/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}><b>{i.customer.name}</b></Link><span className="sub">{i.number}<span className="show-sm-inline"> · <StatusBadge status={i.displayStatus} /></span></span></td>
                <td className="hide-sm muted">{formatDate(i.issueDate)}</td>
                <td className="hide-sm muted">{formatDate(i.dueDate)}{i.displayStatus === 'overdue' && <span className="sub neg">{daysBetween(i.dueDate, todayISO())} days late</span>}</td>
                <td className="hide-sm"><StatusBadge status={i.displayStatus} /></td>
                <td className="amount">{money(i.totals.total)}</td>
                <td className="amount hide-sm">{['paid', 'void', 'draft'].includes(i.displayStatus) ? <span className="muted">—</span> : money(i.balanceDue)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : data.length ? (
          <EmptyState kind="invoice" title="No invoices match">Try another tab or search.</EmptyState>
        ) : (
          <EmptyState kind="invoice" title="Send your first invoice" actions={<Link className="btn sm primary" to="/app/invoices/new">Create invoice</Link>}>Add a customer, line items and terms. You’ll see a live preview as you type.</EmptyState>
        ))}
      </section>
    </>
  );
}

type Draft = { customerId: string; issueDate: string; dueDate: string; items: { description: string; quantity: string; price: string }[]; taxRate: string; discount: string; notes: string };

export function InvoiceEditor() {
  const { id } = useParams();
  const editing = !!id;
  useDocumentTitle(editing ? 'Edit invoice' : 'New invoice');
  const { business } = useAuth();
  const money = useMoney();
  const toast = useToast();
  const nav = useNavigate();
  const customers = useApi<Customer[]>('/customers');
  const existing = useApi<Invoice>(editing ? `/invoices/${id}` : null);
  const [newCustomer, setNewCustomer] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  const [d, setD] = useState<Draft>({
    customerId: '', issueDate: today, dueDate: addDaysISO(today, business?.paymentTermsDays ?? 14),
    items: [{ description: '', quantity: '1', price: '' }], taxRate: ((business?.defaultTaxRateBps || 0) / 100).toString(), discount: '', notes: '',
  });

  useEffect(() => {
    const inv = existing.data;
    if (!inv) return;
    setD({
      customerId: inv.customerId, issueDate: inv.issueDate, dueDate: inv.dueDate,
      items: inv.items.map((it) => ({ description: it.description, quantity: String(it.quantity), price: centsToInput(it.unitCents) })),
      taxRate: (inv.taxRateBps / 100).toString(), discount: inv.discountCents ? centsToInput(inv.discountCents) : '', notes: inv.notes,
    });
  }, [existing.data]);

  const parsed = useMemo(() => {
    const items: LineItem[] = d.items.map((it) => ({ description: it.description, quantity: Number(it.quantity) || 0, unitCents: toCents(it.price || '0') ?? 0 }));
    const taxRateBps = Math.round((Number(d.taxRate) || 0) * 100);
    const discountCents = toCents(d.discount || '0') ?? 0;
    return { items, taxRateBps, discountCents, totals: invoiceTotals({ items, taxRateBps, discountCents }) };
  }, [d]);

  const setItem = (i: number, k: keyof Draft['items'][number], v: string) => setD((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const customer = customers.data?.find((c) => c.id === d.customerId);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    for (const [i, it] of d.items.entries()) {
      if (toCents(it.price) === null) { setError(`Line ${i + 1}: enter a price with at most 2 decimals`); return; }
    }
    if (d.discount && toCents(d.discount) === null) { setError('Discount must be an amount with at most 2 decimals'); return; }
    const rate = Number(d.taxRate || 0);
    if (!(rate >= 0 && rate <= 100) || Math.round(rate * 100) !== rate * 100) { setError('Tax rate must be between 0 and 100 with at most 2 decimals'); return; }
    setBusy(true);
    try {
      const body = { customerId: d.customerId, issueDate: d.issueDate, dueDate: d.dueDate, items: parsed.items, taxRateBps: parsed.taxRateBps, discountCents: parsed.discountCents, notes: d.notes };
      const inv = await api<Invoice>(editing ? `/invoices/${id}` : '/invoices', { method: editing ? 'PATCH' : 'POST', body });
      toast(editing ? 'Invoice updated' : `Draft ${inv.number} created`);
      nav(`/app/invoices/${inv.id}`, { replace: true });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (editing && existing.error) return <ErrorBox message={existing.error} />;
  if (editing && existing.data && ['paid', 'void'].includes(existing.data.status)) return <ErrorBox message={`A ${existing.data.status} invoice cannot be edited.`} />;

  return (
    <>
      <PageHeader eyebrow={<Link className="link" to="/app/invoices">← Invoices</Link>} title={editing ? `Edit ${existing.data?.number || 'invoice'}` : 'New invoice'}
        actions={<><Link className="btn outline" to={editing ? `/app/invoices/${id}` : '/app/invoices'}>Cancel</Link><button className="btn primary" form="inv-form" disabled={busy}>{busy && <span className="spinner" />}{editing ? 'Save changes' : 'Save draft'}</button></>} />
      <div className="editor">
        <form id="inv-form" className="panel" onSubmit={save}>
          <div className="panel-body form-grid">
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="field">
              <label htmlFor="cust">Customer</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="select" id="cust" required value={d.customerId} onChange={(e) => setD({ ...d, customerId: e.target.value })}>
                  <option value="">{customers.loading ? 'Loading…' : 'Choose a customer'}</option>
                  {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" className="btn outline" onClick={() => setNewCustomer(true)}><Icon name="plus" size={15} />New</button>
              </div>
            </div>
            <div className="form-grid two">
              <div className="field"><label htmlFor="iss">Issue date</label><input className="input" id="iss" type="date" required value={d.issueDate} onChange={(e) => setD({ ...d, issueDate: e.target.value })} /></div>
              <div className="field"><label htmlFor="due">Due date</label><input className="input" id="due" type="date" required min={d.issueDate} value={d.dueDate} onChange={(e) => setD({ ...d, dueDate: e.target.value })} />
                <span className="hint">{[0, 7, 14, 30].map((n) => <button key={n} type="button" className="btn ghost sm" onClick={() => setD({ ...d, dueDate: addDaysISO(d.issueDate, n) })}>{n ? `Net ${n}` : 'On receipt'}</button>)}</span></div>
            </div>
            <div className="field">
              <span className="label">Line items</span>
              <table className="items-table">
                <thead><tr><th>Description</th><th style={{ width: 72 }}>Qty</th><th style={{ width: 120 }}>Unit price</th><th style={{ width: 104 }} className="r">Amount</th><th /></tr></thead>
                <tbody>{d.items.map((it, i) => (
                  <tr key={i}>
                    <td><input className="input" aria-label={`Line ${i + 1} description`} required maxLength={300} value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Service or product" /></td>
                    <td><input className="input num" aria-label={`Line ${i + 1} quantity`} inputMode="decimal" required value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} /></td>
                    <td><input className="input num" aria-label={`Line ${i + 1} unit price`} inputMode="decimal" required value={it.price} onChange={(e) => setItem(i, 'price', e.target.value)} placeholder="0.00" /></td>
                    <td className="lt num">{money(lineTotalCents(parsed.items[i].quantity, parsed.items[i].unitCents))}</td>
                    <td><button type="button" className="btn ghost icon sm" aria-label={`Remove line ${i + 1}`} disabled={d.items.length === 1} onClick={() => setD({ ...d, items: d.items.filter((_, j) => j !== i) })}><Icon name="trash" size={15} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
              <button type="button" className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setD({ ...d, items: [...d.items, { description: '', quantity: '1', price: '' }] })}><Icon name="plus" size={15} />Add line</button>
            </div>
            <div className="form-grid two">
              <div className="field"><label htmlFor="disc">Discount</label><div className="input-affix"><span>{business?.currency}</span><input className="input num" id="disc" inputMode="decimal" value={d.discount} onChange={(e) => setD({ ...d, discount: e.target.value })} placeholder="0.00" style={{ paddingLeft: 48 }} /></div></div>
              <div className="field"><label htmlFor="tax">Tax rate (%)</label><input className="input num" id="tax" inputMode="decimal" value={d.taxRate} onChange={(e) => setD({ ...d, taxRate: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="notes">Notes & payment instructions</label><textarea className="textarea" id="notes" maxLength={2000} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="e.g. bank details, thank-you note" /></div>
          </div>
        </form>
        <div className="paper-wrap">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Live preview</div>
          <Paper business={business!} number={existing.data?.number || 'Draft'} status="draft"
            customer={customer ? { name: customer.name, email: customer.email, address: customer.address } : { name: 'Customer', email: '', address: '' }}
            issueDate={d.issueDate} dueDate={d.dueDate} items={parsed.items} taxRateBps={parsed.taxRateBps} totals={parsed.totals} notes={d.notes} />
        </div>
      </div>
      {newCustomer && <CustomerForm customer={null} onClose={() => setNewCustomer(false)} onSaved={(c) => { setNewCustomer(false); customers.reload(); setD((p) => ({ ...p, customerId: c.id })); }} />}
    </>
  );
}

export function Paper(p: {
  business: Business; number: string; status: InvoiceStatus; customer: Invoice['customer']; issueDate: string; dueDate: string;
  items: LineItem[]; taxRateBps: number; totals: Invoice['totals']; notes: string; amountPaid?: number; balanceDue?: number;
}) {
  const money = useMoney();
  return (
    <article className="paper" aria-label={`Invoice ${p.number} preview`}>
      <div className="paper-head">
        <div><span className="wordmark" style={{ fontSize: 16 }}>mor<span>gan</span></span><h2 style={{ marginTop: 14 }}>{p.business.name}</h2><div className="meta">{[p.business.address, p.business.email].filter(Boolean).join('\n')}</div></div>
        <div style={{ textAlign: 'right' }}><div className="label">Invoice</div><h2>{p.number}</h2><div className="meta">Issued {formatDate(p.issueDate)}<br />Due {formatDate(p.dueDate)}</div>
          {p.status !== 'draft' && <div style={{ marginTop: 10 }}><span className={`paper-stamp ${p.status}`}>{p.status === 'partial' ? 'Part paid' : p.status}</span></div>}
        </div>
      </div>
      <div className="paper-parties"><div><div className="label">Bill to</div><b>{p.customer.name}</b><div className="meta">{[p.customer.email, p.customer.address].filter(Boolean).join('\n')}</div></div></div>
      <table>
        <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Unit</th><th className="r">Amount</th></tr></thead>
        <tbody>{p.items.map((it, i) => (
          <tr key={i}><td>{it.description || <span style={{ color: '#a9a294' }}>Item description</span>}</td><td className="r">{it.quantity}</td><td className="r">{money(it.unitCents)}</td><td className="r">{money(lineTotalCents(it.quantity, it.unitCents))}</td></tr>
        ))}</tbody>
      </table>
      <div className="paper-totals">
        <div><span>Subtotal</span><span>{money(p.totals.subtotal)}</span></div>
        {p.totals.discount > 0 && <div><span>Discount</span><span>−{money(p.totals.discount)}</span></div>}
        {p.taxRateBps > 0 && <div><span>Tax ({(p.taxRateBps / 100).toFixed(2)}%)</span><span>{money(p.totals.tax)}</span></div>}
        <div className="grand"><span>Total</span><span>{money(p.totals.total)}</span></div>
        {!!p.amountPaid && <><div><span>Paid</span><span>−{money(p.amountPaid)}</span></div><div className="grand" style={{ fontSize: 15 }}><span>Balance due</span><span>{money(p.balanceDue!)}</span></div></>}
      </div>
      {p.notes && <div className="paper-notes">{p.notes}</div>}
    </article>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const { business, mailConfigured } = useAuth();
  const money = useMoney();
  const toast = useToast();
  const nav = useNavigate();
  const { data: inv, error, loading, reload, setData } = useApi<Invoice>(`/invoices/${id}`);
  useDocumentTitle(inv ? inv.number : 'Invoice');
  const [modal, setModal] = useState<'pay' | 'send' | 'void' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string, method = 'POST', body?: unknown, success?: string) {
    setBusy(true);
    try {
      const res = await api<Invoice>(`/invoices/${id}${path}`, { method, body });
      if (method === 'DELETE' && !path) { toast(success || 'Deleted'); nav('/app/invoices'); return; }
      setData(res); setModal(null); if (success) toast(success);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !inv) return <section className="panel"><LoadingRows rows={8} /></section>;
  const canPay = inv.status === 'sent';
  const paidPct = inv.totals.total ? Math.round((inv.amountPaid / inv.totals.total) * 100) : 0;

  return (
    <>
      <PageHeader eyebrow={<Link className="link" to="/app/invoices">← Invoices</Link>}
        title={<>{inv.number} <StatusBadge status={inv.displayStatus} /></>}
        description={`${inv.customer.name} · issued ${formatDate(inv.issueDate)} · due ${formatDate(inv.dueDate)}`}
        actions={<>
          <a className="btn outline" href={`/api/invoices/${inv.id}/pdf?download=1`}><Icon name="download" size={16} />PDF</a>
          {!['paid', 'void'].includes(inv.status) && <Link className="btn outline" to={`/app/invoices/${inv.id}/edit`}><Icon name="edit" size={16} />Edit</Link>}
          {canPay && <button className="btn primary" onClick={() => setModal('pay')}><Icon name="cash" size={16} />Record payment</button>}
          {inv.status === 'draft' && <button className="btn primary" onClick={() => setModal('send')}><Icon name="mail" size={16} />Send</button>}
        </>} />
      <div className="detail">
        <Paper business={business!} number={inv.number} status={inv.displayStatus} customer={inv.customer} issueDate={inv.issueDate} dueDate={inv.dueDate}
          items={inv.items} taxRateBps={inv.taxRateBps} totals={inv.totals} notes={inv.notes} amountPaid={inv.amountPaid} balanceDue={inv.balanceDue} />
        <div className="stack">
          <section className="panel"><div className="panel-body">
            <div className="eyebrow">Balance due</div>
            <div className="kpi-value num" style={{ fontSize: 32, margin: '6px 0' }}>{money(inv.status === 'void' ? 0 : inv.balanceDue)}</div>
            <div className="progress" aria-label={`${paidPct}% paid`}><span style={{ width: `${paidPct}%` }} /></div>
            <small className="muted">{money(inv.amountPaid)} of {money(inv.totals.total)} paid</small>
            <dl className="facts" style={{ marginTop: 14 }}>
              <div><dt>Customer</dt><dd>{inv.customer.name}</dd></div>
              <div><dt>Due</dt><dd>{formatDate(inv.dueDate)}{inv.displayStatus === 'overdue' && <span className="neg"> · {daysBetween(inv.dueDate, todayISO())}d late</span>}</dd></div>
              <div><dt>Sent</dt><dd>{inv.sentAt ? `${formatDate(inv.sentAt)} · ${inv.sentVia === 'email' ? `emailed to ${inv.sentTo}` : 'marked manually'}` : 'Not sent'}</dd></div>
            </dl>
          </div></section>
          {inv.status === 'draft' && <div className="callout info"><Icon name="alert" size={16} /><span>Drafts don’t count toward receivables. Send the invoice or mark it as sent to start tracking payment.</span></div>}
          <section className="panel">
            <div className="panel-head"><h2>Payments</h2>{canPay && <button className="btn sm outline" onClick={() => setModal('pay')}>Add</button>}</div>
            <div style={{ paddingTop: 10 }}>
              {inv.payments.length ? (
                <ul className="list">{inv.payments.map((p) => (
                  <li key={p.id} className="list-row">
                    <span className="lr-main"><b className="num">{money(p.amountCents)}</b><small>{formatDate(p.date)} · {p.method}</small></span>
                    <button className="btn ghost sm" disabled={busy} onClick={() => act(`/payments/${p.id}`, 'DELETE', undefined, 'Payment removed')}>Remove</button>
                  </li>
                ))}</ul>
              ) : <p className="muted" style={{ padding: '0 20px 18px', fontSize: 14 }}>No payments recorded.</p>}
            </div>
          </section>
          <section className="panel"><div className="panel-body action-list">
            {inv.status === 'draft' && <button className="btn outline" disabled={busy} onClick={() => act('/mark-sent', 'POST', undefined, 'Marked as sent')}><Icon name="check" size={16} />Mark as sent (without emailing)</button>}
            {inv.status === 'sent' && <button className="btn outline" onClick={() => setModal('send')}><Icon name="mail" size={16} />Email again</button>}
            <a className="btn outline" href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener"><Icon name="eye" size={16} />Open PDF</a>
            {inv.status === 'sent' && !inv.payments.length && <button className="btn danger" onClick={() => setModal('void')}>Void invoice</button>}
            {inv.status === 'draft' && <button className="btn danger" onClick={() => setModal('delete')}><Icon name="trash" size={16} />Delete draft</button>}
          </div></section>
        </div>
      </div>

      {modal === 'pay' && <PaymentModal inv={inv} busy={busy} onClose={() => setModal(null)} onSubmit={(b) => act('/payments', 'POST', b, 'Payment recorded')} />}
      {modal === 'send' && (
        <SendModal inv={inv} mailConfigured={mailConfigured} busy={busy} onClose={() => setModal(null)}
          onSend={(b) => act('/send', 'POST', b, `Invoice emailed to ${b.to}`)} onMarkSent={() => act('/mark-sent', 'POST', undefined, 'Marked as sent')} />
      )}
      {modal === 'void' && (
        <Modal title={`Void ${inv.number}?`} onClose={() => setModal(null)} footer={<><button className="btn outline" onClick={() => setModal(null)}>Cancel</button><button className="btn danger" disabled={busy} onClick={() => act('/void', 'POST', undefined, 'Invoice voided')}>Void invoice</button></>}>
          <p className="muted">The invoice stays on record but no longer counts as money owed to you. This can’t be undone.</p>
        </Modal>
      )}
      {modal === 'delete' && (
        <Modal title={`Delete draft ${inv.number}?`} onClose={() => setModal(null)} footer={<><button className="btn outline" onClick={() => setModal(null)}>Cancel</button><button className="btn danger" disabled={busy} onClick={() => act('', 'DELETE', undefined, 'Draft deleted')}>Delete</button></>}>
          <p className="muted">The draft is permanently removed.</p>
        </Modal>
      )}
    </>
  );
}

function PaymentModal({ inv, busy, onClose, onSubmit }: { inv: Invoice; busy: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const money = useMoney();
  const [error, setError] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const cents = toCents(f.amount);
    if (cents === null || cents <= 0) return setError('Enter a positive amount with at most 2 decimals');
    if (cents > inv.balanceDue) return setError(`Amount exceeds the balance due (${money(inv.balanceDue)})`);
    onSubmit({ amountCents: cents, date: f.date, method: f.method });
  }
  return (
    <Modal title="Record payment" description={`${inv.number} · balance ${money(inv.balanceDue)}`} onClose={onClose}
      footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn primary" form="pay-form" disabled={busy}>{busy && <span className="spinner" />}Record payment</button></>}>
      <form id="pay-form" className="form-grid" onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-grid two">
          <div className="field"><label htmlFor="p-amt">Amount received</label><input className="input num" id="p-amt" name="amount" inputMode="decimal" required defaultValue={centsToInput(inv.balanceDue)} autoFocus /></div>
          <div className="field"><label htmlFor="p-date">Date received</label><input className="input" id="p-date" name="date" type="date" required defaultValue={todayISO()} max={todayISO()} /></div>
        </div>
        <div className="field"><label htmlFor="p-method">Method</label><select className="select" id="p-method" name="method">{['Bank transfer', 'Card', 'Cash', 'Check', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></div>
        <p className="muted" style={{ fontSize: 13 }}>An income transaction is added to your records automatically. Morgan does not move money.</p>
      </form>
    </Modal>
  );
}

function SendModal({ inv, mailConfigured, busy, onClose, onSend, onMarkSent }: { inv: Invoice; mailConfigured: boolean; busy: boolean; onClose: () => void; onSend: (b: { to: string; message: string }) => void; onMarkSent: () => void }) {
  const [to, setTo] = useState(inv.customer.email);
  const [message, setMessage] = useState('');
  return (
    <Modal title={`Send ${inv.number}`} onClose={onClose}
      footer={mailConfigured
        ? <><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !to} onClick={() => onSend({ to, message })}>{busy && <span className="spinner" />}Send email</button></>
        : <><a className="btn outline" href={`/api/invoices/${inv.id}/pdf?download=1`}><Icon name="download" size={16} />Download PDF</a>{inv.status === 'draft' && <button className="btn primary" disabled={busy} onClick={onMarkSent}>Mark as sent</button>}</>}>
      {mailConfigured ? (
        <div className="form-grid">
          <div className="field"><label htmlFor="s-to">To</label><input className="input" id="s-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} required /></div>
          <div className="field"><label htmlFor="s-msg">Message (optional)</label><textarea className="textarea" id="s-msg" maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <p className="muted" style={{ fontSize: 13 }}>The PDF is attached. The invoice is marked as sent only after the email provider accepts the message.</p>
        </div>
      ) : (
        <div className="callout"><Icon name="alert" size={16} /><span>Email delivery isn’t configured on this server, so Morgan can’t send this for you. Download the PDF and send it yourself, then mark the invoice as sent.</span></div>
      )}
    </Modal>
  );
}
