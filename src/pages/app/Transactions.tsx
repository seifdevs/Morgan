import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBox, Icon, LoadingRows, Modal, PageHeader, useToast , Marker } from '../../components/ui';
import { EmptyState } from '../../components/illustrations/Illustrations';
import { api, ApiError, type Txn } from '../../lib/api';
import { downloadCsv, normaliseDate, parseCsv } from '../../lib/csv';
import { formatDate, todayISO } from '../../lib/dates';
import { useApi, useDocumentTitle, useMoney } from '../../lib/hooks';
import { centsToInput, toCents } from '../../../shared/money.js';

type List = { items: Txn[]; total: number; income: number; expenses: number; unclassified?: number; currency?: string; page: number; limit: number };
type Facets = { categories: string[]; vendors: string[]; currencies?: string[] };
const SUGGESTED = ['Client revenue', 'Payroll', 'Rent & workspace', 'Software', 'Contractors', 'Marketing', 'Travel', 'Equipment', 'Office & admin', 'Taxes & fees', 'Insurance', 'Utilities'];

export default function Transactions() {
  useDocumentTitle('Transactions');
  const money = useMoney();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get('search') || '');
  const [editing, setEditing] = useState<Txn | 'new' | null>(params.get('new') ? 'new' : null);
  const [classifying, setClassifying] = useState<Txn | null>(null);
  const [importing, setImporting] = useState(!!params.get('import'));
  const [deleting, setDeleting] = useState<Txn | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of ['search', 'from', 'to', 'type', 'category', 'vendor', 'currency', 'sort', 'dir', 'page']) { const v = params.get(k); if (v) q.set(k, v); }
    q.set('limit', '50');
    return q.toString();
  }, [params]);
  const { data, error, loading, reload } = useApi<List>(`/transactions?${query}`);
  const facets = useApi<Facets>('/transactions/facets');

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    if (k !== 'page') p.delete('page');
    p.delete('new'); p.delete('import');
    setParams(p, { replace: true });
  };
  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => { if ((params.get('search') || '') !== searchInput) set('search', searchInput); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line

  const sortBy = (k: 'date' | 'amount') => {
    const p = new URLSearchParams(params);
    const cur = params.get('sort') || 'date';
    p.set('dir', cur === k && params.get('dir') !== 'asc' ? 'asc' : 'desc');
    p.set('sort', k);
    setParams(p, { replace: true });
  };
  const sortIcon = (k: string) => ((params.get('sort') || 'date') === k ? (params.get('dir') === 'asc' ? '↑' : '↓') : '');
  const filtered = ['search', 'from', 'to', 'type', 'category', 'vendor', 'currency'].some((k) => params.get(k));
  const page = Number(params.get('page') || 0);
  const summaryMoney = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: data?.currency || 'USD' }).format(value / 100);

  async function exportCsv() {
    try {
      const rows: (string | number)[][] = [['Date', 'Description', 'Vendor', 'Category', 'Amount', 'Notes']];
      const q = new URLSearchParams(query);
      q.set('limit', '500');
      for (let p = 0; ; p++) {
        q.set('page', String(p));
        const res = await api<List>(`/transactions?${q}`);
        res.items.forEach((t) => rows.push([t.date, t.description, t.vendor, t.category, centsToInput(t.amountCents), t.notes]));
        if ((p + 1) * 500 >= res.total) break;
      }
      downloadCsv(`morgan-transactions-${todayISO()}.csv`, rows);
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try { await api(`/transactions/${deleting.id}`, { method: 'DELETE' }); toast('Transaction deleted'); setDeleting(null); reload(); facets.reload(); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <>
      <PageHeader eyebrow="Analyze" title="Transactions" description="Every income and expense record in your workspace. Payments recorded on invoices and bills appear here automatically."
        actions={<>
          <Link className="btn primary" to="/app/bank-accounts"><Icon name="cash" size={16} />Import statement</Link>
          <button className="btn outline" onClick={() => setImporting(true)}><Icon name="upload" size={16} />Import transactions CSV</button>
          <button className="btn outline" onClick={exportCsv} disabled={!data?.total}><Icon name="download" size={16} />Export</button>
          <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />Add transaction</button>
        </>} />
      <section className="panel">
        <div className="toolbar">
          <label className="search"><Icon name="search" size={16} /><span className="sr-only">Search</span>
            <input className="input" type="search" placeholder="Search description, vendor, category, notes" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} /></label>
          <select className="select" aria-label="Type" value={params.get('type') || ''} onChange={(e) => set('type', e.target.value)}>
            <option value="">All types</option><option value="income">Income</option><option value="expense">Expenses</option>
          </select>
          <select className="select" aria-label="Category" value={params.get('category') || ''} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>{facets.data?.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="select" aria-label="Vendor" value={params.get('vendor') || ''} onChange={(e) => set('vendor', e.target.value)}>
            <option value="">All vendors</option>{facets.data?.vendors.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="select" aria-label="Currency" value={params.get('currency') || ''} onChange={(e) => set('currency', e.target.value)}>
            <option value="">All currencies</option>{facets.data?.currencies?.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="input" type="date" aria-label="From date" value={params.get('from') || ''} onChange={(e) => set('from', e.target.value)} />
          <input className="input" type="date" aria-label="To date" value={params.get('to') || ''} onChange={(e) => set('to', e.target.value)} />
          {filtered && <button className="btn ghost sm" onClick={() => { setSearchInput(''); setParams({}, { replace: true }); }}>Clear filters</button>}
        </div>
        {data && data.total > 0 && (
          <div className="summary-bar">
            <span><b className="num">{data.total.toLocaleString()}</b> transactions</span>
            <span>Income <b className="num pos">{summaryMoney(data.income)}</b><small className="sub">{data.currency} totals</small></span>
            <span>Expenses <b className="num">{summaryMoney(data.expenses)}</b><small className="sub">{data.currency} totals</small></span>
            <span>Operating net <b className={`num ${data.income - data.expenses < 0 ? 'neg' : ''}`}>{summaryMoney(data.income - data.expenses)}</b><small className="sub">{data.currency} totals · statement movements needing review excluded</small></span>
            {data.unclassified ? <span className="callout info" style={{ margin: 0, padding: '8px 10px' }}>{data.unclassified} bank movement{data.unclassified === 1 ? '' : 's'} need classification</span> : null}
          </div>
        )}
        {error && <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={reload} /></div>}
        {loading && !data && <LoadingRows rows={8} />}
        {data && (data.items.length ? (
          <>
            <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
              <table className="table responsive">
                <thead><tr>
                  <th><button className="th-sort" onClick={() => sortBy('date')}>Date {sortIcon('date')}</button></th>
                  <th>Description</th><th className="hide-sm">Category</th>
                  <th className="r"><button className="th-sort" onClick={() => sortBy('amount')}>Amount {sortIcon('amount')}</button></th>
                  <th className="hide-sm"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody>{data.items.map((t) => (
                  <tr key={t.id}>
                    <td className="muted num">{formatDate(t.date)}</td>
                    <td><b>{t.description}</b><span className="sub">{[t.vendor, t.source === 'invoice-payment' ? 'Invoice payment' : t.source === 'bill-payment' ? 'Bill payment' : ['import','bank-statement'].includes(t.source || '') ? 'Imported statement record' : '', t.reconciliationStatus === 'matched' ? 'Matched' : t.source === 'bank-statement' ? (t.financialClass === 'unclassified' || !t.financialClass ? 'Needs financial review' : t.financialClass.replaceAll('-', ' ')) : ''].filter(Boolean).join(' · ')}{t.source === 'bank-statement' && t.reconciliationStatus !== 'matched' && <button className="link-btn" style={{ marginLeft: 8 }} onClick={() => setClassifying(t)}>{t.financialClass && t.financialClass !== 'unclassified' ? 'Review class' : 'Classify'}</button>}</span></td>
                    <td className="hide-sm"><button className="btn ghost sm" onClick={() => set('category', t.category)}>{t.category}</button></td>
                    <td className={`amount ${t.amountCents >= 0 ? 'pos' : ''}`}>{new Intl.NumberFormat(undefined, { style: 'currency', currency: t.currency || 'USD', signDisplay: 'exceptZero' }).format(t.amountCents / 100)}</td>
                    <td className="hide-sm"><div className="row-actions">
                      {t.invoiceId || t.billId || t.source === 'bank-statement' ? (
                        <span className="muted" style={{ fontSize: 12 }} title={t.source === 'bank-statement' ? 'Statement source records stay traceable; reconcile them from Bank accounts' : 'Edit this payment on its invoice or bill'}><Icon name="lock" size={15} /></span>
                      ) : (<>
                        <button className="btn ghost icon sm" aria-label={`Edit ${t.description}`} onClick={() => setEditing(t)}><Icon name="edit" size={15} /></button>
                        <button className="btn ghost icon sm" aria-label={`Delete ${t.description}`} onClick={() => setDeleting(t)}><Icon name="trash" size={15} /></button>
                      </>)}
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {data.total > data.limit && (
              <div className="pager">
                <span>{page * data.limit + 1}–{Math.min(data.total, (page + 1) * data.limit)} of {data.total}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn sm outline" disabled={page === 0} onClick={() => set('page', String(page - 1))}>Previous</button>
                  <button className="btn sm outline" disabled={(page + 1) * data.limit >= data.total} onClick={() => set('page', String(page + 1))}>Next</button>
                </span>
              </div>
            )}
          </>
        ) : filtered ? (
          <EmptyState kind="ledger" title="No matching transactions" actions={<button className="btn sm outline" onClick={() => { setSearchInput(''); setParams({}); }}>Clear filters</button>}>Try a different search or date range.</EmptyState>
        ) : (
          <EmptyState kind="ledger" title="Start your ledger" actions={<><button className="btn sm primary" onClick={() => setEditing('new')}>Add transaction</button><button className="btn sm outline" onClick={() => setImporting(true)}>Import CSV</button></>}>
            Add income and expenses by hand, or import a CSV export from your bank or accounting software.
          </EmptyState>
        ))}
      </section>

      {editing && <TxnForm txn={editing === 'new' ? null : editing} categories={[...new Set([...(facets.data?.categories || []), ...SUGGESTED])]} vendors={facets.data?.vendors || []}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); facets.reload(); }} />}
      {classifying && <ClassificationForm txn={classifying} onClose={() => setClassifying(null)} onSaved={() => { setClassifying(null); reload(); }} />}
      {importing && <ImportCsv onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); facets.reload(); }} />}
      {deleting && (
        <Modal title="Delete transaction?" description={`${deleting.description} · ${money(deleting.amountCents)} on ${formatDate(deleting.date)}`} onClose={() => setDeleting(null)}
          footer={<><button className="btn outline" onClick={() => setDeleting(null)}>Cancel</button><button className="btn danger" onClick={confirmDelete}>Delete</button></>}>
          <p className="muted">This permanently removes the record and updates all totals.</p>
        </Modal>
      )}
      <p className="chart-note"><Link className="link" to="/app/spending">See spending breakdown →</Link></p>
    </>
  );
}

function ClassificationForm({ txn, onClose, onSaved }: { txn: Txn; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [financialClass, setFinancialClass] = useState(txn.financialClass || 'unclassified');
  const [category, setCategory] = useState(txn.category || 'Uncategorized');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/bank-transactions/${txn.id}/classification`, { method: 'PATCH', body: { financialClass, category } });
      toast('Statement transaction classified'); onSaved();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="Classify statement transaction" description={`${txn.description} · ${new Intl.NumberFormat(undefined, { style: 'currency', currency: txn.currency || 'USD' }).format(txn.amountCents / 100)} · ${formatDate(txn.date)}`} onClose={onClose}
    footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn primary" form="classification-form" disabled={busy}>{busy && <span className="spinner" />}Save classification</button></>}>
    <form id="classification-form" className="form-grid" onSubmit={submit}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="field"><label htmlFor="txn-class">Financial treatment</label><select className="select" id="txn-class" value={financialClass} onChange={(e) => setFinancialClass(e.target.value)}>
        <option value="unclassified">Needs review</option>{txn.amountCents > 0 ? <><option value="income">Business income</option><option value="owner-contribution">Owner contribution</option><option value="refund">Refund of business expense</option></> : <><option value="expense">Business expense</option><option value="owner-withdrawal">Owner withdrawal</option><option value="card-payment">Credit card payment</option></>}<option value="transfer">Internal transfer</option><option value="financing">Loan or financing</option><option value="reversal">Reversal</option>
      </select><span className="hint">The cash balance changes when a transaction is recorded. Income and spending reports include only items classified as business income or expense.</span></div>
      <div className="field"><label htmlFor="txn-category">Category</label><input className="input" id="txn-category" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} /></div>
    </form>
  </Modal>;
}

export function TxnForm({ txn, categories, vendors, onClose, onSaved }: { txn: Txn | null; categories: string[]; vendors: string[]; onClose: () => void; onSaved: (t: Txn) => void }) {
  const toast = useToast();
  const [type, setType] = useState<'income' | 'expense'>(txn ? (txn.amountCents >= 0 ? 'income' : 'expense') : 'expense');
  const [financialClass, setFinancialClass] = useState(txn?.financialClass || (txn?.amountCents && txn.amountCents > 0 ? 'income' : 'expense'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const cents = toCents(f.amount);
    if (cents === null || cents <= 0) { setError('Enter a positive amount with at most 2 decimals'); return; }
    setBusy(true); setError('');
    try {
      const body = { ...f, amountCents: cents, type, financialClass };
      const saved = await api<Txn>(txn ? `/transactions/${txn.id}` : '/transactions', { method: txn ? 'PATCH' : 'POST', body });
      toast(txn ? 'Transaction updated' : 'Transaction added');
      onSaved(saved);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title={txn ? 'Edit transaction' : 'Add transaction'} onClose={onClose}
      footer={<><button className="btn outline" type="button" onClick={onClose}>Cancel</button><button className="btn primary" form="txn-form" disabled={busy}>{busy && <span className="spinner" />}Save</button></>}>
      <form id="txn-form" className="form-grid" onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="segmented" role="group" aria-label="Type">
          <button type="button" aria-pressed={type === 'expense'} onClick={() => { setType('expense'); if (!['expense', 'owner-withdrawal', 'card-payment', 'transfer', 'financing', 'reversal', 'unclassified'].includes(financialClass)) setFinancialClass('expense'); }}>{type === 'expense' && <Marker id="type-seg" className="seg-marker" />}Expense</button>
          <button type="button" aria-pressed={type === 'income'} onClick={() => { setType('income'); if (!['income', 'owner-contribution', 'refund', 'transfer', 'financing', 'reversal', 'unclassified'].includes(financialClass)) setFinancialClass('income'); }}>{type === 'income' && <Marker id="type-seg" className="seg-marker" />}Income</button>
        </div>
        <div className="field"><label htmlFor="t-treatment">Financial treatment</label><select className="select" id="t-treatment" value={financialClass} onChange={(e) => setFinancialClass(e.target.value)}>
          {type === 'expense' ? <><option value="expense">Business expense</option><option value="owner-withdrawal">Owner withdrawal</option><option value="card-payment">Credit card payment</option></> : <><option value="income">Business income</option><option value="owner-contribution">Owner contribution</option><option value="refund">Refund of business expense</option></>}<option value="transfer">Internal transfer</option><option value="financing">Loan or financing</option><option value="reversal">Reversal · review later</option><option value="unclassified">Needs review</option>
        </select><span className="hint">Only business income and expenses appear in those reports. Other cash movements remain in recorded cash.</span></div>
        <div className="form-grid two">
          <div className="field"><label htmlFor="t-amount">Amount</label><input className="input num" id="t-amount" name="amount" inputMode="decimal" required defaultValue={txn ? centsToInput(Math.abs(txn.amountCents)) : ''} placeholder="0.00" autoFocus /></div>
          <div className="field"><label htmlFor="t-date">Date</label><input className="input" id="t-date" name="date" type="date" required defaultValue={txn?.date || todayISO()} /></div>
        </div>
        <div className="field"><label htmlFor="t-desc">Description</label><input className="input" id="t-desc" name="description" required maxLength={200} defaultValue={txn?.description} /></div>
        <div className="form-grid two">
          <div className="field"><label htmlFor="t-vendor">{type === 'income' ? 'Payer' : 'Vendor'}</label><input className="input" id="t-vendor" name="vendor" list="vendor-list" maxLength={120} defaultValue={txn?.vendor} /></div>
          <div className="field"><label htmlFor="t-cat">Category</label><input className="input" id="t-cat" name="category" list="cat-list" maxLength={60} defaultValue={txn?.category || ''} placeholder="Uncategorized" /></div>
        </div>
        <datalist id="vendor-list">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="cat-list">{categories.map((v) => <option key={v} value={v} />)}</datalist>
        <div className="field"><label htmlFor="t-notes">Notes</label><textarea className="textarea" id="t-notes" name="notes" maxLength={1000} defaultValue={txn?.notes} /></div>
      </form>
    </Modal>
  );
}

const FIELDS = [
  { key: 'date', label: 'Date', required: true, guess: /date|posted/i },
  { key: 'description', label: 'Description', required: true, guess: /desc|memo|detail|name|payee/i },
  { key: 'amount', label: 'Amount (signed)', required: false, guess: /^amount$|amount|value|sum/i },
  { key: 'debit', label: 'Debit / money out', required: false, guess: /debit|withdraw|out/i },
  { key: 'credit', label: 'Credit / money in', required: false, guess: /credit|deposit|in$/i },
  { key: 'vendor', label: 'Vendor / payer', required: false, guess: /vendor|merchant|payee|counterparty/i },
  { key: 'category', label: 'Category', required: false, guess: /categ/i },
] as const;

function ImportCsv({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function load(file: File) {
    setError('');
    if (file.size > 5 * 1024 * 1024) { setError('File is larger than 5 MB'); return; }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) { setError('The file needs a header row and at least one data row'); return; }
    setFileName(file.name);
    setRows(parsed);
    const header = parsed[0];
    const m: Record<string, number> = {};
    for (const f of FIELDS) {
      const i = header.findIndex((h, idx) => f.guess.test(h.trim()) && !Object.values(m).includes(idx));
      if (i >= 0) m[f.key] = i;
    }
    if (m.amount !== undefined) { delete m.debit; delete m.credit; }
    setMap(m);
  }

  const built = useMemo(() => {
    if (!rows) return [];
    return rows.slice(1).map((r) => {
      const get = (k: string) => (map[k] !== undefined ? (r[map[k]] || '').trim() : '');
      let cents: number | null = null;
      if (map.amount !== undefined) cents = toCents(get('amount').replace(/[()]/g, (c) => (c === '(' ? '-' : '')));
      else {
        const d = get('debit') ? toCents(get('debit')) : 0, c = get('credit') ? toCents(get('credit')) : 0;
        cents = d === null || c === null ? null : (c || 0) - Math.abs(d || 0);
      }
      return { date: normaliseDate(get('date')), description: get('description'), vendor: get('vendor'), category: get('category'), cents };
    });
  }, [rows, map]);

  const valid = built.filter((b) => b.cents !== null && b.cents !== 0 && b.description && /^\d{4}-\d{2}-\d{2}$/.test(b.date));
  const ready = map.date !== undefined && map.description !== undefined && (map.amount !== undefined || map.debit !== undefined || map.credit !== undefined);

  async function submit() {
    setBusy(true); setError('');
    try {
      const res = await api<{ imported: number }>('/transactions/import', { method: 'POST', body: { rows: valid.map((b) => ({ date: b.date, description: b.description, vendor: b.vendor, category: b.category, amountCents: Math.abs(b.cents!), type: b.cents! > 0 ? 'income' : 'expense' })) } });
      toast(`Imported ${res.imported} transactions`);
      onDone();
    } catch (e) {
      const d = (e as ApiError).details as { row: number; message: string }[] | undefined;
      setError((e as Error).message + (d?.length ? ` First issue — row ${d[0].row}: ${d[0].message}` : ''));
    } finally { setBusy(false); }
  }

  return (
    <Modal wide title="Import transactions from CSV" description="Use an export from your bank or accounting software. Nothing is saved until you confirm." onClose={onClose}
      footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ready || !valid.length || busy} onClick={submit}>{busy && <span className="spinner" />}Import {valid.length || ''} rows</button></>}>
      <div className="form-grid">
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) load(f); }}>
          <Icon name="upload" size={22} />
          <b style={{ color: 'var(--text)' }}>{fileName || 'Choose a CSV file or drop it here'}</b>
          <span style={{ fontSize: 13 }}>Columns needed: date, description, and an amount (or separate debit/credit columns).</span>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </div>
        {rows && (
          <>
            <div className="map-grid">
              {FIELDS.map((f) => (
                <div className="field" key={f.key}><label>{f.label}{f.required && ' *'}</label>
                  <select className="select" value={map[f.key] ?? ''} onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value === '') delete n[f.key]; else n[f.key] = Number(e.target.value); return n; })}>
                    <option value="">— not mapped —</option>{rows[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="callout info"><Icon name="eye" size={16} /><span>{valid.length} of {built.length} rows are ready. Rows with an unreadable date, empty description, or zero/invalid amount are skipped. Positive amounts are income, negative are expenses.</span></div>
            <div className="table-wrap panel" style={{ maxHeight: 260, overflow: 'auto' }}>
              <table className="table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="r">Amount</th></tr></thead>
                <tbody>{built.slice(0, 8).map((b, i) => (
                  <tr key={i} style={{ opacity: valid.includes(b) ? 1 : 0.4 }}><td>{b.date}</td><td>{b.description}</td><td>{b.category || 'Uncategorized'}</td><td className="amount">{b.cents === null ? 'invalid' : centsToInput(b.cents)}</td></tr>
                ))}</tbody></table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
