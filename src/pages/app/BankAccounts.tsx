import { useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { parseCsv, normaliseDate } from '../../lib/csv';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { ApiError } from '../../lib/api';
import { ErrorBox, Icon, LoadingRows, Modal, PageHeader, useToast } from '../../components/ui';
import { toCents } from '../../../shared/money.js';

type ImportSummary = { id: string; filename: string; importedAt: string; periodStart: string; periodEnd: string; closingBalanceCents: number | null; discrepancyCents: number | null; importedCount: number; duplicateCount: number };
type Account = { id: string; institution: string; name: string; type: string; currency: string; maskedIdentifier: string; openingBalanceCents: number | null; openingBalanceDate: string | null; status: string; latestImport: ImportSummary | null; calculatedBalanceCents: number | null; latestTransactionDate: string | null };
type History = { id: string; filename: string; importedAt: string; periodStart: string; periodEnd: string; closingBalanceCents: number | null; calculatedClosingBalanceCents: number | null; discrepancyCents: number | null; transactionCount: number; importedCount: number; duplicateCount: number; status: string }[];
type Col = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'vendor' | 'currency' | 'reference' | 'balance';
const fields: { key: Col; label: string; re: RegExp }[] = [
  { key: 'date', label: 'Transaction date', re: /date|posted/i }, { key: 'description', label: 'Description', re: /desc|memo|detail|narrative|transaction/i },
  { key: 'amount', label: 'Signed amount', re: /^amount$|amount|value|sum/i }, { key: 'debit', label: 'Debit', re: /debit|withdraw|money out/i },
  { key: 'credit', label: 'Credit', re: /credit|deposit|money in/i }, { key: 'vendor', label: 'Counterparty', re: /vendor|merchant|payee|counterparty/i },
  { key: 'currency', label: 'Currency', re: /currency|ccy/i }, { key: 'reference', label: 'Reference', re: /reference|ref( no)?|trace|id/i }, { key: 'balance', label: 'Running balance', re: /balance/i },
];

function parseAmount(input: string) {
  let s = input.trim().replace(/[\s$£€¥EGP]/gi, '');
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()]/g, '').replace(/-/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const cents = toCents(`${negative ? '-' : ''}${s}`);
  return cents;
}
const fmt = (cents: number | null, currency: string) => cents === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);

export default function BankAccounts() {
  useDocumentTitle('Bank accounts');
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Account[]>('/bank-accounts');
  const [accountForm, setAccountForm] = useState<Account | null | false>(false);
  const [importAccount, setImportAccount] = useState<Account | null>(null);
  const [historyAccount, setHistoryAccount] = useState<Account | null>(null);
  const [reconcileAccount, setReconcileAccount] = useState<Account | null>(null);
  const [busyId, setBusyId] = useState('');
  async function archive(account: Account) {
    setBusyId(account.id);
    try { await api(`/bank-accounts/${account.id}`, { method: 'PATCH', body: { status: account.status === 'active' ? 'archived' : 'active' } }); toast(account.status === 'active' ? 'Account archived' : 'Account restored'); reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusyId(''); }
  }
  return <>
    <PageHeader eyebrow="Financial accounts" title="Bank accounts" description="Manage statement-backed accounts and review the source and coverage behind each recorded balance. Morgan does not connect to your bank." actions={<button className="btn primary" onClick={() => setAccountForm(null)}><Icon name="plus" size={16} />Add account</button>} />
    <div className="callout info"><Icon name="lock" size={17} /><span>Statement balances are historical. They are not live bank balances. Account identifiers are masked after saving.</span></div>
    {error && <ErrorBox message={error} onRetry={reload} />}{loading && !data && <section className="panel"><LoadingRows rows={5} /></section>}
    {data && (data.length ? <div className="bank-account-list">{data.map((a) => <section className={`panel bank-account ${a.status === 'archived' ? 'archived' : ''}`} key={a.id}>
      <div className="bank-account-head"><span className="bank-account-icon"><Icon name="cash" size={21} /></span><div className="bank-account-title"><span className="eyebrow">{a.institution} · {a.type.replace('-', ' ')}</span><h2>{a.name} {a.status === 'archived' && <span className="badge">Archived</span>}</h2><p>{a.currency}{a.maskedIdentifier && ` · ${a.maskedIdentifier}`}</p></div>
        <div className="bank-account-actions">{a.status === 'active' && <button className="btn primary sm" onClick={() => setImportAccount(a)}><Icon name="upload" size={15} />Import statement</button>}<button className="btn outline sm" onClick={() => setAccountForm(a)}>Edit</button><button className="btn ghost sm" disabled={busyId === a.id} onClick={() => archive(a)}>{a.status === 'active' ? 'Archive' : 'Restore'}</button></div></div>
      <div className="bank-account-facts"><div><span>Statement closing balance</span><b className="num">{fmt(a.latestImport?.closingBalanceCents ?? null, a.currency)}</b><small>{a.latestImport ? `${a.latestImport.periodEnd} · ${new Date(a.latestImport.importedAt).toLocaleDateString()}` : 'No statement imported'}</small></div><div><span>Recorded transaction balance</span><b className="num">{fmt(a.calculatedBalanceCents, a.currency)}</b><small>{a.latestTransactionDate ? `Through ${a.latestTransactionDate}` : 'No transactions recorded'}</small></div><div><span>Latest statement</span><b>{a.latestImport?.filename || '—'}</b><small>{a.latestImport ? `${a.latestImport.importedCount} imported · ${a.latestImport.duplicateCount} duplicates skipped` : 'CSV statements supported'}</small></div><div className="bank-account-row-actions">{a.latestImport?.discrepancyCents !== null && a.latestImport?.discrepancyCents !== undefined && a.latestImport.discrepancyCents !== 0 ? <span className="badge overdue">Balance discrepancy {fmt(a.latestImport.discrepancyCents, a.currency)}</span> : a.latestImport ? <span className="badge paid">Statement reconciles</span> : null}<button className="link-btn" onClick={() => setReconcileAccount(a)}>Review transactions →</button><button className="link-btn" onClick={() => setHistoryAccount(a)}>Import history →</button></div></div>
    </section>)}</div> : <section className="panel bank-empty"><span className="bank-account-icon"><Icon name="cash" size={23} /></span><h2>Add your first bank account</h2><p>Keep imported statements and transaction history organized by account.</p><button className="btn primary" onClick={() => setAccountForm(null)}><Icon name="plus" size={16} />Add account</button></section>)}
    {accountForm !== false && <AccountForm account={accountForm || null} onClose={() => setAccountForm(false)} onSaved={() => { setAccountForm(false); reload(); }} />}
    {importAccount && <StatementImport account={importAccount} onClose={() => setImportAccount(null)} onDone={() => { setImportAccount(null); reload(); }} />}
    {historyAccount && <ImportHistory account={historyAccount} onClose={() => setHistoryAccount(null)} />}
    {reconcileAccount && <ReconcileTransactions account={reconcileAccount} onClose={() => setReconcileAccount(null)} />}
  </>;
}

function AccountForm({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const opening = f.openingBalance ? toCents(f.openingBalance) : null;
    try { await api(account ? `/bank-accounts/${account.id}` : '/bank-accounts', { method: account ? 'PATCH' : 'POST', body: { ...f, ...(account ? {} : { openingBalanceCents: opening }) } }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={account ? 'Edit bank account' : 'Add bank account'} description="Enter only a display name and, if useful, the last digits of the account identifier. Never enter online banking credentials." onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn primary" form="bank-account-form" disabled={busy}>{busy && <span className="spinner" />}Save account</button></>}>
    <form id="bank-account-form" className="form-grid" onSubmit={submit}>{error && <div className="form-error">{error}</div>}<div className="form-grid two"><div className="field"><label htmlFor="bank-institution">Bank or institution</label><input className="input" id="bank-institution" name="institution" required maxLength={120} defaultValue={account?.institution} /></div><div className="field"><label htmlFor="bank-name">Account display name</label><input className="input" id="bank-name" name="name" required maxLength={100} defaultValue={account?.name} /></div></div>
    <div className="form-grid two"><div className="field"><label htmlFor="bank-type">Account type</label><select className="select" id="bank-type" name="type" defaultValue={account?.type || 'checking'}><option value="checking">Checking / current</option><option value="savings">Savings</option><option value="credit-card">Business credit card</option><option value="other">Other</option></select></div><div className="field"><label htmlFor="bank-currency">Currency</label><select className="select" id="bank-currency" name="currency" defaultValue={account?.currency || 'USD'}>{['USD','EGP','GBP','EUR','CAD','AUD','AED','SAR','CHF','JPY'].map((c) => <option key={c}>{c}</option>)}</select></div></div>
    <div className="field"><label htmlFor="bank-identifier">Account identifier <span className="muted">(optional, masked)</span></label><input className="input" id="bank-identifier" name="accountNumber" inputMode="numeric" maxLength={80} defaultValue={account?.maskedIdentifier?.replace('•••• ', '')} placeholder="Last few digits only" /></div>
    {!account && <div className="form-grid two"><div className="field"><label htmlFor="bank-opening">Optional opening balance</label><input className="input" id="bank-opening" name="openingBalance" inputMode="decimal" placeholder="0.00" /></div><div className="field"><label htmlFor="bank-opening-date">Balance date</label><input className="input" id="bank-opening-date" name="openingBalanceDate" type="date" /></div></div>}</form>
  </Modal>;
}

function StatementImport({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null); const toast = useToast();
  const [file, setFile] = useState(''), [headers, setHeaders] = useState<string[]>([]), [rows, setRows] = useState<string[][]>([]), [map, setMap] = useState<Partial<Record<Col, number>>>({}), [opening, setOpening] = useState(''), [closing, setClosing] = useState('');
  const [review, setReview] = useState<{ rows: { date: string; description: string; amountCents: number; currency: string; duplicate: boolean; suggestedMatch: { kind: string; party: string } | null }[]; summary: { count: number; duplicates: number; creditsCents: number; debitsCents: number; periodStart: string; periodEnd: string; calculatedClosingBalanceCents: number | null; discrepancyCents: number | null } | null } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [step, setStep] = useState<'file'|'review'>('file');
  const rawRows = rows;
  const built = useMemo(() => rawRows.map((r) => {
    const get = (k: Col) => map[k] === undefined ? '' : (r[map[k]!] || '').trim();
    let amount = map.amount !== undefined ? parseAmount(get('amount')) : null;
    if (map.amount === undefined && (map.debit !== undefined || map.credit !== undefined)) { const debit = get('debit') ? parseAmount(get('debit')) : 0; const credit = get('credit') ? parseAmount(get('credit')) : 0; amount = debit === null || credit === null ? null : (credit || 0) - Math.abs(debit || 0); }
    const date = normaliseDate(get('date'));
    return { date, description: get('description'), amountCents: amount, currency: get('currency').toUpperCase() || account.currency, vendor: get('vendor'), reference: get('reference'), runningBalanceCents: get('balance') ? parseAmount(get('balance')) : null };
  }), [rawRows, map, account.currency]);
  const valid = built.filter((r) => r.amountCents !== null && r.amountCents !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !!r.description);
  const ready = map.date !== undefined && map.description !== undefined && (map.amount !== undefined || map.debit !== undefined || map.credit !== undefined);
  async function load(f: File) {
    setError(''); setReview(null); setStep('file');
    if (f.size > 10 * 1024 * 1024) { setError('File exceeds the 10 MB CSV limit.'); return; }
    if (!f.name.toLowerCase().endsWith('.csv') && f.type !== 'text/csv') { setError('This import currently accepts CSV only. PDF and Excel parsing is not enabled here. Export the statement as CSV and try again.'); return; }
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2 || parsed.length > 5001) { setError(parsed.length > 5001 ? 'The CSV exceeds the 5,000 transaction limit.' : 'The file needs a header and at least one transaction.'); return; }
    setFile(f.name); setHeaders(parsed[0]); setRows(parsed.slice(1));
    const found: Partial<Record<Col, number>> = {};
    fields.forEach((field) => { const idx = parsed[0].findIndex((h, i) => field.re.test(h.trim()) && !Object.values(found).includes(i)); if (idx >= 0) found[field.key] = idx; });
    if (found.amount !== undefined) { delete found.debit; delete found.credit; }
    setMap(found);
  }
  async function preview() {
    setBusy(true); setError('');
    try { const result = await api<typeof review>('/bank-statements/preview', { method: 'POST', body: { accountId: account.id, openingBalanceCents: opening ? parseAmount(opening) : null, closingBalanceCents: closing ? parseAmount(closing) : null, rows: valid.map(({ date, description, amountCents, currency, vendor, reference, runningBalanceCents }) => ({ date, description, amountCents, currency, vendor, reference, runningBalanceCents })) } }); setReview(result); setStep('review'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function commit() {
    if (!review) return; setBusy(true); setError('');
    try { const result = await api<{ imported: number; duplicates: number; matchedSuggestions: number }>('/bank-statements/import', { method: 'POST', body: { accountId: account.id, filename: file, openingBalanceCents: opening ? parseAmount(opening) : null, closingBalanceCents: closing ? parseAmount(closing) : null, rows: valid.map(({ date, description, amountCents, currency, vendor, reference, runningBalanceCents }) => ({ date, description, amountCents, currency, vendor, reference, runningBalanceCents })) } }); toast(`Imported ${result.imported} · ${result.duplicates} duplicates skipped · ${result.matchedSuggestions} suggested matches`); onDone(); }
    catch (e) { const details = (e as ApiError).details as { row?: number; message?: string }[] | undefined; setError((e as Error).message + (details?.[0]?.message ? ` Row ${details[0].row}: ${details[0].message}` : '')); } finally { setBusy(false); }
  }
  return <Modal wide title={step === 'file' ? `Import statement · ${account.name}` : 'Review statement import'} description={step === 'file' ? `CSV statement · account currency ${account.currency}. Review transactions and possible duplicates before committing.` : `${review?.summary?.periodStart} to ${review?.summary?.periodEnd} · ${review?.summary?.count} transactions detected`} onClose={onClose} footer={<>{step === 'review' && <button className="btn outline" onClick={() => setStep('file')}>Back</button>}<button className="btn outline" onClick={onClose}>Cancel</button>{step === 'file' ? <button className="btn primary" disabled={!ready || valid.length === 0 || busy} onClick={preview}>{busy && <span className="spinner" />}Review {valid.length || ''} rows</button> : <button className="btn primary" disabled={busy} onClick={commit}>{busy && <span className="spinner" />}Confirm import</button>}</>}>
    <div className="form-grid">{error && <div className="form-error" role="alert">{error}</div>}{step === 'file' ? <>
      <div className="dropzone" role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}><Icon name="upload" size={22} /><b>{file || 'Choose a CSV statement or drop it here'}</b><span>UTF-8, semicolon and comma separated files · up to 10 MB and 5,000 rows</span><input ref={input} hidden type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></div>
      {headers.length > 0 && <><div className="map-grid">{fields.map((f) => <div className="field" key={f.key}><label>{f.label}{['date','description'].includes(f.key) ? ' *' : ''}</label><select className="select" value={map[f.key] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}><option value="">— not mapped —</option>{headers.map((h,i) => <option key={i} value={i}>{h || `Column ${i+1}`}</option>)}</select></div>)}</div>
      <div className="form-grid two"><div className="field"><label htmlFor="stmt-opening">Statement opening balance <span className="muted">(optional)</span></label><input id="stmt-opening" className="input" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" /></div><div className="field"><label htmlFor="stmt-closing">Statement closing balance <span className="muted">(optional)</span></label><input id="stmt-closing" className="input" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="0.00" /></div></div>
      <div className="callout info"><Icon name="eye" size={16} /><span>{valid.length} of {built.length} rows have a date, description, and non-zero amount. {built.length - valid.length} invalid rows will be left out of the import.</span></div><div className="table-wrap panel" style={{ maxHeight: 260, overflow: 'auto' }}><table className="table"><thead><tr><th>Date</th><th>Description</th><th>Currency</th><th className="r">Amount</th></tr></thead><tbody>{built.slice(0,10).map((r,i) => <tr key={i} style={{ opacity: valid.includes(r) ? 1 : .4 }}><td>{r.date || '—'}</td><td>{r.description || '—'}</td><td>{r.currency}</td><td className="amount">{r.amountCents === null ? 'Invalid' : fmt(r.amountCents, r.currency)}</td></tr>)}</tbody></table></div></>}
      </> : review && <><section className="summary-bar"><span><b>{review.summary?.count}</b> rows</span><span>Credits <b className="pos">{fmt(review.summary?.creditsCents ?? null, account.currency)}</b></span><span>Debits <b>{fmt(review.summary?.debitsCents ?? null, account.currency)}</b></span><span>Duplicates <b>{review.summary?.duplicates}</b></span></section>{review.summary?.discrepancyCents !== null && review.summary?.discrepancyCents !== undefined && <div className={`callout ${review.summary.discrepancyCents === 0 ? 'success' : 'warning'}`}><Icon name={review.summary.discrepancyCents === 0 ? 'check' : 'alert'} size={16} /><span>{review.summary.discrepancyCents === 0 ? 'Statement closing balance agrees with the opening balance plus imported activity.' : `Balance difference: ${fmt(review.summary.discrepancyCents, account.currency)}. The statement and calculated closing balance do not agree.`} Calculated close: {fmt(review.summary.calculatedClosingBalanceCents, account.currency)}.</span></div>}<div className="table-wrap"><table className="table responsive"><thead><tr><th>Date</th><th>Description</th><th className="hide-sm">Review</th><th className="r">Amount</th></tr></thead><tbody>{review.rows?.map((r,i) => <tr key={i}><td>{r.date}</td><td><b>{r.description}</b><small className="sub">{r.currency}</small></td><td className="hide-sm">{r.duplicate ? <span className="badge">Duplicate · will skip</span> : r.suggestedMatch ? <span className="badge">Possible {r.suggestedMatch.kind} match · {r.suggestedMatch.party}</span> : <span className="muted">Needs matching</span>}</td><td className={`amount ${r.amountCents > 0 ? 'pos' : ''}`}>{fmt(r.amountCents, r.currency)}</td></tr>)}</tbody></table></div><p className="chart-note">Possible matches are suggestions only. Imported statements are user-supplied records and do not independently verify payment.</p></>}
    </div>
  </Modal>;
}

function ImportHistory({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data, loading, error, reload } = useApi<History>(`/bank-accounts/${account.id}/imports`);
  return <Modal wide title={`Statement history · ${account.name}`} onClose={onClose}><div>{error && <ErrorBox message={error} onRetry={reload} />}{loading && !data && <LoadingRows rows={4} />}{data && (data.length ? <div className="table-wrap"><table className="table responsive"><thead><tr><th>Statement</th><th>Period</th><th>Imported</th><th className="r">Rows</th><th className="r">Closing balance</th></tr></thead><tbody>{data.map((i) => <tr key={i.id}><td><b>{i.filename}</b><small className="sub">{i.importedCount} imported · {i.duplicateCount} duplicates skipped</small></td><td>{i.periodStart} – {i.periodEnd}</td><td>{new Date(i.importedAt).toLocaleString()}</td><td className="amount">{i.transactionCount}</td><td className="amount">{fmt(i.closingBalanceCents, account.currency)}{i.discrepancyCents !== null && i.discrepancyCents !== 0 && <small className="sub neg">Difference {fmt(i.discrepancyCents, account.currency)}</small>}</td></tr>)}</tbody></table></div> : <p className="muted">No statements imported yet.</p>)}</div></Modal>;
}

type ReconcileRow = { id: string; date: string; description: string; amountCents: number; currency: string; reconciliationStatus: string; matchedRecordType?: string; matches: { kind: 'invoice'|'bill'|'existing'|'transfer'; id: string; label: string; amountCents: number }[] };
function ReconcileTransactions({ account, onClose }: { account: Account; onClose: () => void }) {
  const toast = useToast(); const { data, loading, error, reload } = useApi<ReconcileRow[]>(`/bank-accounts/${account.id}/transactions`);
  const [pending, setPending] = useState<{ txn: ReconcileRow; match: ReconcileRow['matches'][number] } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function confirm() {
    if (!pending) return; setBusy(true); setMessage('');
    try { await api(`/bank-transactions/${pending.txn.id}/reconcile`, { method: 'POST', body: { kind: pending.match.kind, recordId: pending.match.id } }); toast('Transaction matched using user supplied statement evidence'); setPending(null); reload(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    <Modal wide title={`Reconcile transactions · ${account.name}`} description="Suggested matches require your confirmation. A user supplied statement is not independent bank verification." onClose={onClose}>
      {error && <ErrorBox message={error} onRetry={reload} />}{loading && !data && <LoadingRows rows={5} />}{data && (data.length ? <div className="table-wrap"><table className="table responsive"><thead><tr><th>Date</th><th>Transaction</th><th className="r">Amount</th><th>Suggested matches</th></tr></thead><tbody>{data.map((t) => <tr key={t.id}><td>{t.date}</td><td><b>{t.description}</b><small className="sub">{t.reconciliationStatus === 'matched' ? `Matched · ${t.matchedRecordType || 'record'}` : 'Unmatched · statement supplied by user'}</small></td><td className={`amount ${t.amountCents > 0 ? 'pos' : ''}`}>{fmt(t.amountCents, t.currency)}</td><td>{t.reconciliationStatus === 'matched' ? <span className="badge paid">Matched</span> : t.matches.length ? <div className="match-suggestions">{t.matches.map((m) => <button key={`${m.kind}-${m.id}`} className="btn sm outline" onClick={() => { setPending({ txn: t, match: m }); setMessage(''); }}>{m.label} · Match</button>)}</div> : <span className="muted">No close match found</span>}</td></tr>)}</tbody></table></div> : <p className="muted">No statement transactions found on this account.</p>)}
    </Modal>
    {pending && <Modal title="Confirm transaction match" description={`${pending.txn.description} · ${fmt(pending.txn.amountCents, pending.txn.currency)} on ${pending.txn.date}`} onClose={() => setPending(null)} footer={<><button className="btn outline" onClick={() => setPending(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={confirm}>{busy && <span className="spinner" />}Confirm match</button></>}>
      {message && <div className="form-error" role="alert">{message}</div>}<p>Match this statement transaction to <b>{pending.match.label}</b>?</p><p className="muted">Morgan will preserve the transaction source and record this as a user confirmed match.</p>
    </Modal>}
  </>;
}
