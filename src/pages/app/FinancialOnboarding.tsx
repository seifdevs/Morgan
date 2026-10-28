import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, PageHeader, LoadingRows, ErrorBox } from '../../components/ui';
import { api, type Business, type PlannedItem } from '../../lib/api';
import { useApi, useDocumentTitle, useMoney } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { centsToInput, toCents } from '../../../shared/money.js';

const today = new Date().toISOString().slice(0, 10);
const blank = { name: '', type: 'expense' as 'expense' | 'income', category: 'Software', amount: '', cadence: 'monthly', nextDate: today, confidence: 'planned', notes: '' };

export default function FinancialOnboarding() {
  useDocumentTitle('Financial setup');
  const { data, error, loading, reload } = useApi<{ business: Business; items: PlannedItem[]; today: string }>('/financial-setup');
  const { setSession } = useAuth();
  const money = useMoney();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<{ name: string; type: string; currency: string; balance: string; balanceDate: string; notes: string }[] | null>(null);
  const [industry, setIndustry] = useState<string | null>(null), [budget, setBudget] = useState<string | null>(null), [reserve, setReserve] = useState<string | null>(null);
  const [item, setItem] = useState(blank), [busy, setBusy] = useState(false), [formError, setFormError] = useState('');
  const steps = ['Starting position', 'Expected activity', 'Monthly plan', 'Review'];
  const accountRows = accounts ?? (data ? data.business.cashAccounts?.length ? data.business.cashAccounts.map((a) => ({ name: a.name, type: a.type, currency: a.currency, balance: centsToInput(a.balanceCents), balanceDate: a.balanceDate, notes: a.notes || '' })) : data.business.openingBalanceDate ? [{ name: 'Business cash', type: 'checking', currency: data.business.currency, balance: centsToInput(data.business.openingBalanceCents), balanceDate: data.business.openingBalanceDate, notes: '' }] : [{ name: '', type: 'checking', currency: data.business.currency, balance: '', balanceDate: today, notes: '' }] : []);

  async function savePosition() {
    const monthlyBudgetCents = budget === null ? data!.business.monthlyBudgetCents : budget ? toCents(budget) : null;
    const minimumCashCents = reserve === null ? data!.business.minimumCashCents : reserve ? toCents(reserve) : null;
    const cashAccounts = accountRows.filter((a) => a.name.trim() || a.balance.trim()).map((a) => {
      const balanceCents = toCents(a.balance);
      if (!a.name.trim() || balanceCents === null) throw new Error('Each cash account needs a name and a valid balance. Remove any unused rows.');
      return { ...a, balanceCents };
    });
    if (budget && toCents(budget) === null) throw new Error('Enter a valid monthly budget.');
    if (reserve && toCents(reserve) === null) throw new Error('Enter a valid minimum reserve.');
    const result = await api<{ business: Business }>('/financial-setup', { method: 'PATCH', body: {
      cashAccounts, monthlyBudgetCents, minimumCashCents, industry: industry ?? data!.business.industry,
    } });
    setSession({ business: result.business });
    reload();
  }
  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = toCents(item.amount);
    if (!amountCents || amountCents < 1) { setFormError('Enter an amount greater than zero.'); return; }
    setBusy(true); setFormError('');
    try {
      await api('/planning-items', { method: 'POST', body: { ...item, nextDate: item.nextDate === today ? data!.today : item.nextDate, amountCents, endDate: null } });
      setItem(blank); reload();
    } catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }
  async function complete() {
    setBusy(true); setFormError('');
    try {
      await savePosition();
      const result = await api<{ business: Business; emailNotification?: { status: string } }>('/financial-setup', { method: 'PATCH', body: { complete: true } });
      setSession({ business: result.business }); nav('/app', { replace: true });
    } catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }

  return <div className="setup-wrap">
    <PageHeader eyebrow="Getting started" title="Set your financial starting point" description="A few details help Morgan build a useful, traceable cash-flow view. Every figure is user-entered and can be changed later." />
    {error && <ErrorBox message={error} onRetry={reload} />}
    {loading && !data ? <section className="panel"><LoadingRows rows={5} /></section> : data && <>
      <section className="panel setup-panel">
        <div className="setup-progress"><div><span className="eyebrow">STEP {String(step + 1).padStart(2, '0')} OF 04</span><h2>{steps[step]}</h2></div><span className="muted">{data.business.name}</span></div>
        <div className="setup-steps" aria-label="Setup progress">{steps.map((s, i) => <span key={s} className={i <= step ? 'active' : ''}><b>0{i + 1}</b>{s}</span>)}</div>
        {step === 0 && <div className="panel-body setup-form">
          <p className="muted">Add manually entered account balances. Accounts must use the business currency and same balance date before Morgan combines them. No bank connection is active.</p>
          {accountRows.map((a, i) => <div className="setup-item-form" key={i}>
            <div className="form-grid two">
              <div className="field"><label htmlFor={`account-name-${i}`}>Account name</label><input className="input" id={`account-name-${i}`} value={a.name} placeholder="Operating account" onChange={(e) => setAccounts(accountRows.map((x, n) => n === i ? { ...x, name: e.target.value } : x))} /></div>
              <div className="field"><label htmlFor={`account-type-${i}`}>Account type</label><select className="select" id={`account-type-${i}`} value={a.type} onChange={(e) => setAccounts(accountRows.map((x, n) => n === i ? { ...x, type: e.target.value } : x))}><option value="checking">Checking</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="other">Other</option></select></div>
              <div className="field"><label htmlFor={`account-currency-${i}`}>Currency</label><input className="input" id={`account-currency-${i}`} value={a.currency} readOnly /><span className="hint">Must match business currency.</span></div>
              <div className="field"><label htmlFor={`account-balance-${i}`}>Current balance ({a.currency})</label><input className="input num" id={`account-balance-${i}`} inputMode="decimal" value={a.balance} placeholder="0.00" onChange={(e) => setAccounts(accountRows.map((x, n) => n === i ? { ...x, balance: e.target.value } : x))} /></div>
              <div className="field"><label htmlFor={`account-date-${i}`}>Balance date</label><input className="input" type="date" id={`account-date-${i}`} value={a.balanceDate} onChange={(e) => setAccounts(accountRows.map((x, n) => n === i ? { ...x, balanceDate: e.target.value } : x))} /></div>
              <div className="field"><label htmlFor={`account-notes-${i}`}>Notes · optional</label><input className="input" id={`account-notes-${i}`} value={a.notes} onChange={(e) => setAccounts(accountRows.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} /></div>
            </div>
            {accountRows.length > 1 && <button className="btn ghost sm" type="button" onClick={() => setAccounts(accountRows.filter((_, n) => n !== i))}><Icon name="trash" size={15} />Remove account</button>}
          </div>)}
          <div className="row-actions"><button className="btn outline" type="button" onClick={() => setAccounts([...accountRows, { name: '', type: 'checking', currency: data.business.currency, balance: '', balanceDate: accountRows[0]?.balanceDate || data.today, notes: '' }])}><Icon name="plus" size={15} />Add another account</button></div>
          <div className="field"><label htmlFor="setup-industry">Business type <span className="muted">· optional</span></label><input className="input" id="setup-industry" placeholder="e.g. Design studio" value={industry ?? data.business.industry} onChange={(e) => setIndustry(e.target.value)} /></div>
          {!data.business.openingBalanceDate && !accountRows.some((a) => a.name && a.balance) && <p className="hint">You can skip cash for now. Forecasts will be less complete until a starting balance is added.</p>}
        </div>}
        {step === 1 && <div className="panel-body setup-form">
          <p className="muted">Add expected inflows and recurring expenses you want included in cash planning. These remain planned items; they are never recorded as paid or received.</p>
          <form className="setup-item-form" onSubmit={addItem}>
            <div className="form-grid two">
              <div className="field"><label htmlFor="item-name">Name</label><input className="input" id="item-name" required maxLength={120} value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} placeholder="Software subscription" /></div>
              <div className="field"><label htmlFor="item-kind">Cash movement</label><select className="select" id="item-kind" value={item.type} onChange={(e) => setItem({ ...item, type: e.target.value as 'income' | 'expense' })}><option value="expense">Expected expense</option><option value="income">Expected income</option></select></div>
              <div className="field"><label htmlFor="item-category">Category</label><input className="input" id="item-category" value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value })} /></div>
              <div className="field"><label htmlFor="item-amount">Amount ({data.business.currency})</label><input className="input num" id="item-amount" required inputMode="decimal" value={item.amount} onChange={(e) => setItem({ ...item, amount: e.target.value })} /></div>
              <div className="field"><label htmlFor="item-cadence">Frequency</label><select className="select" id="item-cadence" value={item.cadence} onChange={(e) => setItem({ ...item, cadence: e.target.value })}><option value="once">One time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></div>
              <div className="field"><label htmlFor="item-date">Next expected date</label><input className="input" id="item-date" type="date" required value={item.nextDate === today ? data.today : item.nextDate} onChange={(e) => setItem({ ...item, nextDate: e.target.value })} /></div>
              <div className="field"><label htmlFor="item-confidence">Status</label><select className="select" id="item-confidence" value={item.confidence} onChange={(e) => setItem({ ...item, confidence: e.target.value })}><option value="planned">Planned estimate</option><option value="estimated">Expected estimate</option><option value="contracted">Contracted</option><option value="invoiced">Tracked on an invoice</option></select><span className="hint">Invoice-linked expectations are left out here to avoid counting the same receipt twice.</span></div>
            </div>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <button className="btn outline" type="submit" disabled={busy}><Icon name="plus" size={16} />{busy ? 'Saving…' : 'Add expected item'}</button>
          </form>
          <div className="setup-item-list"><h3>Saved expected items</h3>{data.items.length ? data.items.map((i) => <div className="setup-item" key={i.id}><span><b>{i.name}</b><small>{i.category} · {i.cadence} · next {i.nextDate}</small></span><b className={`num ${i.type === 'income' ? 'pos' : ''}`}>{i.type === 'income' ? '+' : '−'}{money(i.amountCents)}</b></div>) : <p className="muted">Nothing added yet. You can add items later in Cash flow.</p>}</div>
          <button className="btn ghost" type="button" onClick={() => setStep(2)}>Skip expected items</button>
        </div>}
        {step === 2 && <div className="panel-body setup-form">
          <p className="muted">Set your own monthly spending guardrails. These do not change transactions or forecast assumptions.</p>
          <div className="form-grid two">
            <div className="field"><label htmlFor="setup-budget">Overall monthly spending budget · optional</label><input className="input num" id="setup-budget" inputMode="decimal" placeholder="Leave blank if not set" value={budget ?? (data.business.monthlyBudgetCents == null ? '' : centsToInput(data.business.monthlyBudgetCents))} onChange={(e) => setBudget(e.target.value)} /></div>
            <div className="field"><label htmlFor="setup-reserve">Minimum cash reserve · optional</label><input className="input num" id="setup-reserve" inputMode="decimal" placeholder="Leave blank if not set" value={reserve ?? (data.business.minimumCashCents == null ? '' : centsToInput(data.business.minimumCashCents))} onChange={(e) => setReserve(e.target.value)} /></div>
          </div>
          <p className="hint">No budget is inferred. You can edit these values later in Cash flow planning.</p>
        </div>}
        {step === 3 && <div className="panel-body setup-form">
          <p className="muted">Review what Morgan will use to begin your cash-flow plan. You can edit all of it later.</p>
          <dl className="setup-review">
            <div><dt>Starting cash · user-entered estimate</dt><dd className="num">{accountRows.some((a) => a.name && a.balance) ? money(accountRows.reduce((s, a) => s + (toCents(a.balance) || 0), 0)) : 'Not provided'}</dd></div>
            <div><dt>Recurring and one-time items</dt><dd>{data.items.length} saved · expected only</dd></div>
            <div><dt>Monthly spending budget</dt><dd className="num">{budget === null ? (data.business.monthlyBudgetCents == null ? 'Not set' : money(data.business.monthlyBudgetCents)) : budget ? money(toCents(budget) || 0) : 'Not set'}</dd></div>
            <div><dt>Minimum reserve</dt><dd className="num">{reserve === null ? (data.business.minimumCashCents == null ? 'Not set' : money(data.business.minimumCashCents)) : reserve ? money(toCents(reserve) || 0) : 'Not set'}</dd></div>
          </dl>
          {!data.business.openingBalanceDate && !accountRows.some((a) => a.name && a.balance) && <div className="callout info"><Icon name="alert" size={16} /><span>Without starting cash, Morgan cannot show an absolute projected balance. Add it later from Cash flow or Settings.</span></div>}
          {formError && <div className="form-error" role="alert">{formError}</div>}
        </div>}
        <div className="setup-actions">{step > 0 ? <button className="btn outline" onClick={() => setStep(step - 1)}>Back</button> : <button className="btn ghost" onClick={complete}>Skip setup for now</button>}
          {step < 3 ? <button className="btn primary" onClick={async () => { try { if (step === 0 || step === 2) await savePosition(); setFormError(''); setStep(step + 1); } catch (e) { setFormError((e as Error).message); } }}>Continue <Icon name="arrowRight" size={16} /></button> : <button className="btn primary" disabled={busy} onClick={complete}>{busy ? 'Saving…' : 'Finish setup'} <Icon name="check" size={16} /></button>}
        </div>
      </section>
      <p className="setup-foot">Morgan works alongside accounting software. Your entered balances are estimates; no bank connection is active.</p>
    </>}
  </div>;
}
