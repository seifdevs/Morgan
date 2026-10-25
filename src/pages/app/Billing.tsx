import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Icon, LoadingRows, Modal, PageHeader, StatusBadge, useToast , Marker } from '../../components/ui';
import { StackBar } from '../../components/charts/charts';
import { EmptyState } from '../../components/illustrations/Illustrations';
import { api, type Bill, type Customer, type Invoice, type Overview } from '../../lib/api';
import { addDaysISO, daysBetween, formatDate, todayISO } from '../../lib/dates';
import { useApi, useDocumentTitle, useMoney } from '../../lib/hooks';
import { centsToInput, toCents } from '../../../shared/money.js';

/* ---------------- Customers ---------------- */
export function Customers() {
  useDocumentTitle('Customers');
  const money = useMoney();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Customer[]>('/customers');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  async function remove() {
    try { await api(`/customers/${deleting!.id}`, { method: 'DELETE' }); toast('Customer deleted'); setDeleting(null); reload(); }
    catch (e) { toast((e as Error).message, 'error'); setDeleting(null); }
  }
  return (
    <>
      <PageHeader eyebrow="Billing" title="Customers" description="The people and companies you invoice." actions={<button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />Add customer</button>} />
      <section className="panel">
        {error && <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={reload} /></div>}
        {loading && !data && <LoadingRows />}
        {data && (data.length ? (
          <div className="table-wrap"><table className="table responsive">
            <thead><tr><th>Customer</th><th className="hide-sm">Invoices</th><th className="r hide-sm">Invoiced</th><th className="r">Outstanding</th><th className="hide-sm" /></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><span className="sub">{c.email || 'No email'}</span></td>
                <td className="hide-sm muted">{c.invoices}</td>
                <td className="amount hide-sm">{money(c.invoiced || 0)}</td>
                <td className={`amount ${c.outstanding ? '' : 'muted'}`}>{money(c.outstanding || 0)}</td>
                <td className="hide-sm"><div className="row-actions">
                  <button className="btn ghost icon sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Icon name="edit" size={15} /></button>
                  <button className="btn ghost icon sm" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Icon name="trash" size={15} /></button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState kind="people" title="No customers yet" actions={<button className="btn sm primary" onClick={() => setEditing('new')}>Add customer</button>}>Customers are saved once and reused on every invoice.</EmptyState>)}
      </section>
      {editing && <CustomerForm customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {deleting && (
        <Modal title={`Delete ${deleting.name}?`} onClose={() => setDeleting(null)} footer={<><button className="btn outline" onClick={() => setDeleting(null)}>Cancel</button><button className="btn danger" onClick={remove}>Delete</button></>}>
          <p className="muted">Customers with invoices can’t be deleted. Existing invoices keep their own copy of customer details.</p>
        </Modal>
      )}
    </>
  );
}

export function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: (c: Customer) => void }) {
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true); setError('');
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      const c = await api<Customer>(customer ? `/customers/${customer.id}` : '/customers', { method: customer ? 'PATCH' : 'POST', body });
      toast(customer ? 'Customer updated' : 'Customer added');
      onSaved(c);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title={customer ? 'Edit customer' : 'Add customer'} onClose={onClose}
      footer={<><button className="btn outline" type="button" onClick={onClose}>Cancel</button><button className="btn primary" form="cust-form" disabled={busy}>{busy && <span className="spinner" />}Save</button></>}>
      <form id="cust-form" className="form-grid" onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="field"><label htmlFor="c-name">Name</label><input className="input" id="c-name" name="name" required maxLength={120} defaultValue={customer?.name} autoFocus /></div>
        <div className="field"><label htmlFor="c-email">Billing email</label><input className="input" id="c-email" name="email" type="email" defaultValue={customer?.email} /></div>
        <div className="field"><label htmlFor="c-addr">Address</label><textarea className="textarea" id="c-addr" name="address" maxLength={400} defaultValue={customer?.address} /></div>
      </form>
    </Modal>
  );
}

/* ---------------- Receivables ---------------- */
export function Receivables() {
  useDocumentTitle('Receivables');
  const money = useMoney();
  const nav = useNavigate();
  const inv = useApi<Invoice[]>('/invoices');
  const ov = useApi<Overview>('/overview');
  const today = todayISO();
  const open = (inv.data || []).filter((i) => ['sent', 'partial', 'overdue'].includes(i.displayStatus)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const total = open.reduce((s, i) => s + i.balanceDue, 0);
  const overdue = open.filter((i) => i.displayStatus === 'overdue');
  const byCustomer = Object.values(open.reduce<Record<string, { name: string; amount: number; count: number; oldest: number }>>((m, i) => {
    const r = (m[i.customer.name] ||= { name: i.customer.name, amount: 0, count: 0, oldest: 0 });
    r.amount += i.balanceDue; r.count++; r.oldest = Math.max(r.oldest, daysBetween(i.dueDate, today));
    return m;
  }, {})).sort((a, b) => b.amount - a.amount);

  return (
    <>
      <PageHeader eyebrow="Billing" title="Receivables" description="Money owed to you on sent invoices, aged by days past the due date." />
      {(inv.error || ov.error) && <ErrorBox message={inv.error || ov.error || ''} onRetry={() => { inv.reload(); ov.reload(); }} />}
      {(inv.loading || ov.loading) && !inv.data && <section className="panel"><LoadingRows /></section>}
      {inv.data && ov.data && (open.length ? (
        <>
          <section className="statement" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="kpi hero-kpi"><span className="kpi-label">Total outstanding</span><span className="kpi-value num">{money(total)}</span><span className="kpi-foot">{open.length} open invoices</span></div>
            <div className="kpi"><span className="kpi-label">Overdue</span><span className="kpi-value num neg">{money(overdue.reduce((s, i) => s + i.balanceDue, 0))}</span><span className="kpi-foot">{overdue.length} invoices</span></div>
            <div className="kpi"><span className="kpi-label">Due in next 14 days</span><span className="kpi-value num">{money(open.filter((i) => i.dueDate >= today && i.dueDate <= addDaysISO(today, 14)).reduce((s, i) => s + i.balanceDue, 0))}</span><span className="kpi-foot">expected if paid on time</span></div>
          </section>
          <div className="grid main-side">
            <section className="panel">
              <div className="panel-head"><h2>Open invoices · oldest due first</h2></div>
              <div className="table-wrap" style={{ paddingTop: 8 }}><table className="table responsive">
                <thead><tr><th>Customer</th><th className="hide-sm">Due</th><th className="hide-sm">Age</th><th className="r">Balance</th></tr></thead>
                <tbody>{open.map((i) => {
                  const late = daysBetween(i.dueDate, today);
                  return (
                    <tr key={i.id} className="clickable" onClick={() => nav(`/app/invoices/${i.id}`)}>
                      <td><Link to={`/app/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}><b>{i.customer.name}</b></Link><span className="sub">{i.number} · <StatusBadge status={i.displayStatus} /></span></td>
                      <td className="hide-sm muted">{formatDate(i.dueDate)}</td>
                      <td className={`hide-sm ${late > 0 ? 'neg' : 'muted'}`}>{late > 0 ? `${late} days late` : late === 0 ? 'Due today' : `in ${-late} days`}</td>
                      <td className="amount">{money(i.balanceDue)}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </section>
            <div className="stack">
              <section className="panel"><div className="panel-head"><h2>Aging</h2></div><div className="panel-body">
                <StackBar format={money} parts={ov.data.aging.map((a, i) => ({ label: a.label, amount: a.amount, count: a.count, color: ['#2f9b70', '#d6a84f', '#c98a4f', '#c66d5d', '#a04848'][i] }))} />
              </div></section>
              <section className="panel"><div className="panel-head"><h2>By customer</h2></div><div style={{ paddingTop: 10 }}>
                <ul className="list">{byCustomer.map((c) => (
                  <li key={c.name} className="list-row"><span className="lr-main"><b>{c.name}</b><small>{c.count} invoice{c.count > 1 ? 's' : ''}{c.oldest > 0 ? ` · oldest ${c.oldest}d late` : ''}</small></span><span className="lr-amt num">{money(c.amount)}</span></li>
                ))}</ul>
              </div></section>
            </div>
          </div>
        </>
      ) : <section className="panel"><EmptyState kind="invoice" title="Nothing is owed to you right now" actions={<Link className="btn sm primary" to="/app/invoices/new">Create invoice</Link>}>Sent invoices with a remaining balance appear here.</EmptyState></section>)}
    </>
  );
}

/* ---------------- Bills ---------------- */
export function Bills() {
  useDocumentTitle('Bills');
  const money = useMoney();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi<Bill[]>('/bills');
  const [editing, setEditing] = useState<Bill | 'new' | null>(params.get('new') ? 'new' : null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [deleting, setDeleting] = useState<Bill | null>(null);
  const [show, setShow] = useState<'unpaid' | 'paid'>('unpaid');
  const today = todayISO();
  const list = (data || []).filter((b) => b.status === show).sort((a, b) => (show === 'unpaid' ? a.dueDate.localeCompare(b.dueDate) : (b.paidDate || '').localeCompare(a.paidDate || '')));
  const unpaid = (data || []).filter((b) => b.status === 'unpaid');

  async function call(path: string, body?: unknown, msg?: string, method = 'POST') {
    try { await api(path, { method, body }); if (msg) toast(msg); setPaying(null); setDeleting(null); reload(); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <>
      <PageHeader eyebrow="Billing" title="Bills" description="Money you owe suppliers. Marking a bill paid records the expense in your transactions."
        actions={<button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />Add bill</button>} />
      {data && unpaid.length > 0 && (
        <section className="statement" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="kpi hero-kpi"><span className="kpi-label">Unpaid</span><span className="kpi-value num">{money(unpaid.reduce((s, b) => s + b.amountCents, 0))}</span><span className="kpi-foot">{unpaid.length} bills</span></div>
          <div className="kpi"><span className="kpi-label">Past due</span><span className="kpi-value num neg">{money(unpaid.filter((b) => b.dueDate < today).reduce((s, b) => s + b.amountCents, 0))}</span><span className="kpi-foot">{unpaid.filter((b) => b.dueDate < today).length} bills</span></div>
          <div className="kpi"><span className="kpi-label">Due in 7 days</span><span className="kpi-value num">{money(unpaid.filter((b) => b.dueDate >= today && b.dueDate <= addDaysISO(today, 7)).reduce((s, b) => s + b.amountCents, 0))}</span><span className="kpi-foot">upcoming</span></div>
        </section>
      )}
      <section className="panel">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={show === 'unpaid'} onClick={() => setShow('unpaid')}>Unpaid<span className="count">{unpaid.length}</span>{show === 'unpaid' && <Marker id="bill-tab" className="tab-ul" />}</button>
          <button role="tab" aria-selected={show === 'paid'} onClick={() => setShow('paid')}>Paid<span className="count">{(data?.length || 0) - unpaid.length}</span>{show === 'paid' && <Marker id="bill-tab" className="tab-ul" />}</button>
        </div>
        {error && <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={reload} /></div>}
        {loading && !data && <LoadingRows />}
        {data && (list.length ? (
          <div className="table-wrap"><table className="table responsive">
            <thead><tr><th>Vendor</th><th className="hide-sm">Category</th><th className="hide-sm">{show === 'unpaid' ? 'Due' : 'Paid on'}</th><th className="r">Amount</th><th className="hide-sm" /></tr></thead>
            <tbody>{list.map((b) => {
              const late = b.status === 'unpaid' && b.dueDate < today;
              return (
                <tr key={b.id}>
                  <td><b>{b.vendor}</b><span className="sub">{b.description || '—'}{late && <span className="neg"> · {daysBetween(b.dueDate, today)} days past due</span>}</span></td>
                  <td className="hide-sm muted">{b.category}</td>
                  <td className="hide-sm muted">{formatDate(show === 'unpaid' ? b.dueDate : b.paidDate)}</td>
                  <td className="amount">{money(b.amountCents)}</td>
                  <td className="hide-sm"><div className="row-actions">
                    {b.status === 'unpaid' ? (<>
                      <button className="btn sm outline" onClick={() => setPaying(b)}>Mark paid</button>
                      <button className="btn ghost icon sm" aria-label={`Edit ${b.vendor} bill`} onClick={() => setEditing(b)}><Icon name="edit" size={15} /></button>
                      <button className="btn ghost icon sm" aria-label={`Delete ${b.vendor} bill`} onClick={() => setDeleting(b)}><Icon name="trash" size={15} /></button>
                    </>) : <button className="btn sm ghost" onClick={() => call(`/bills/${b.id}/unpay`, undefined, 'Bill marked unpaid; its expense was removed')}>Mark unpaid</button>}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <EmptyState kind="bill" title={show === 'unpaid' ? 'No unpaid bills' : 'No paid bills yet'} actions={show === 'unpaid' && <button className="btn sm primary" onClick={() => setEditing('new')}>Add bill</button>}>Track rent, software, contractors and other obligations with their due dates.</EmptyState>)}
      </section>

      {editing && <BillForm bill={editing === 'new' ? null : editing} onClose={() => { setEditing(null); if (params.get('new')) setParams({}, { replace: true }); }} onSaved={() => { setEditing(null); reload(); }} />}
      {paying && (
        <Modal title={`Mark ${paying.vendor} bill paid`} description={money(paying.amountCents)} onClose={() => setPaying(null)}
          footer={<><button className="btn outline" onClick={() => setPaying(null)}>Cancel</button><button className="btn primary" form="pay-bill">Mark paid</button></>}>
          <form id="pay-bill" className="form-grid" onSubmit={(e) => { e.preventDefault(); call(`/bills/${paying.id}/pay`, { date: new FormData(e.currentTarget).get('date') }, 'Bill paid and expense recorded'); }}>
            <div className="field"><label htmlFor="pb-date">Payment date</label><input className="input" id="pb-date" name="date" type="date" required defaultValue={today} max={today} /></div>
            <p className="muted" style={{ fontSize: 13 }}>An expense transaction for {money(paying.amountCents)} is added to your records.</p>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete bill?" description={`${deleting.vendor} · ${money(deleting.amountCents)}`} onClose={() => setDeleting(null)}
          footer={<><button className="btn outline" onClick={() => setDeleting(null)}>Cancel</button><button className="btn danger" onClick={() => call(`/bills/${deleting.id}`, undefined, 'Bill deleted', 'DELETE')}>Delete</button></>}>
          <p className="muted">This permanently removes the bill.</p>
        </Modal>
      )}
    </>
  );
}

function BillForm({ bill, onClose, onSaved }: { bill: Bill | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const cents = toCents(f.amount);
    if (cents === null || cents <= 0) { setError('Enter a positive amount with at most 2 decimals'); return; }
    setBusy(true); setError('');
    try {
      await api(bill ? `/bills/${bill.id}` : '/bills', { method: bill ? 'PATCH' : 'POST', body: { ...f, amountCents: cents } });
      toast(bill ? 'Bill updated' : 'Bill added');
      onSaved();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const today = todayISO();
  return (
    <Modal title={bill ? 'Edit bill' : 'Add bill'} onClose={onClose}
      footer={<><button className="btn outline" type="button" onClick={onClose}>Cancel</button><button className="btn primary" form="bill-form" disabled={busy}>{busy && <span className="spinner" />}Save</button></>}>
      <form id="bill-form" className="form-grid" onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-grid two">
          <div className="field"><label htmlFor="b-vendor">Vendor</label><input className="input" id="b-vendor" name="vendor" required maxLength={120} defaultValue={bill?.vendor} autoFocus /></div>
          <div className="field"><label htmlFor="b-amt">Amount</label><input className="input num" id="b-amt" name="amount" inputMode="decimal" required defaultValue={bill ? centsToInput(bill.amountCents) : ''} placeholder="0.00" /></div>
        </div>
        <div className="form-grid two">
          <div className="field"><label htmlFor="b-iss">Bill date</label><input className="input" id="b-iss" name="issueDate" type="date" required defaultValue={bill?.issueDate || today} /></div>
          <div className="field"><label htmlFor="b-due">Due date</label><input className="input" id="b-due" name="dueDate" type="date" required defaultValue={bill?.dueDate || addDaysISO(today, 14)} /></div>
        </div>
        <div className="form-grid two">
          <div className="field"><label htmlFor="b-cat">Category</label><input className="input" id="b-cat" name="category" maxLength={60} defaultValue={bill?.category} placeholder="e.g. Software" /></div>
          <div className="field"><label htmlFor="b-desc">Description</label><input className="input" id="b-desc" name="description" maxLength={200} defaultValue={bill?.description} /></div>
        </div>
      </form>
    </Modal>
  );
}
