import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import policies from '../../../shared/policies.json';

type Payment = { reference: string; planId: string; billingInterval: string; amountCents: number; currency: string; status: string; transactionId?: string; createdAt: string; paymentUrl?: string; verifiedAt?: string };
type UsageData = {
  plan: { name: string; id: string };
  plans: Record<'pro'|'max', { name: string; monthlyCents: number; annualCents: number }>;
  period: { month: string; resetsAt: string; timezone: 'UTC' };
  usage: Record<'financialRecords'|'intelligenceRequests'|'pdfReports', { used: number; limit: number; remaining: number }>;
  capabilities: { workspaces: { used: number; limit: number }; seats: { used: number; limit: number }; scenariosPerWorkspace: { used: number; limit: number }; forecastDays: number; monitor: string };
  subscription: { status: string; billingInterval: string|null; currentPeriodEnd: string|null; autoRenew: boolean };
  paymentHistory: Payment[];
  paymentConfigured: boolean;
  automaticBillingAvailable: boolean;
};
const metrics = [
  ['financialRecords', 'Financial records', 'Transactions, invoices, bills, planned entries, and imported statement rows'],
  ['intelligenceRequests', 'Morgan Intelligence', 'Completed customer requested responses'],
  ['pdfReports', 'PDF reports', 'Newly generated financial reports'],
] as const;
const monthLabel = (month: string) => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00.000Z`));
const resetLabel = (date: string) => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(date));
const money = (cents: number, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

export default function Usage() {
  useDocumentTitle('Plan & usage');
  const { data, error, loading, reload } = useApi<UsageData>('/usage');
  const payments = useApi<Payment[]>('/billing/checkouts');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [paymentUrl, setPaymentUrl] = useState(''), [purchaseAccepted, setPurchaseAccepted] = useState(false), [paymentDetails, setPaymentDetails] = useState<Record<string,{ identifier: string; transactionId: string }>>({});
  async function createCheckout(planId: 'pro'|'max', interval: 'monthly'|'annual') {
    const paypalTab = window.open('about:blank', '_blank');
    if (paypalTab) paypalTab.opener = null;
    setBusy(true); setNotice('');
    try {
      const checkout = await api<Payment & { paymentUrl: string }>('/billing/checkouts', { method: 'POST', body: { planId, interval, acceptedPolicies: policies.map(({ id, version }) => ({ policyId: id, version })), purchaseTermsAccepted: true } });
      await reload(); await payments.reload(); setPaymentUrl(checkout.paymentUrl); setPurchaseAccepted(false); setNotice(`Pay ${money(checkout.amountCents)} once through PayPal.Me. Return to Morgan after payment to submit your transaction details; paid access begins only after an administrator verifies the payment.`);
      if (paypalTab) paypalTab.location.replace(checkout.paymentUrl);
    } catch (e) { paypalTab?.close(); setNotice((e as Error).message); }
    finally { setBusy(false); }
  }
  async function submitTransaction(reference: string) {
    setBusy(true); setNotice('');
    try { await api(`/billing/checkouts/${reference}/transaction`, { method: 'POST', body: { transactionId: paymentDetails[reference]?.transactionId, paypalIdentifier: paymentDetails[reference]?.identifier } }); setNotice('Payment submitted. Your payment details have been submitted. Your subscription will be activated once your payment has been verified.'); await payments.reload(); }
    catch (e) { setNotice((e as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeader eyebrow="Account / Allowances" title="Plan & usage" description="Monthly limits follow UTC calendar months and reset at midnight on the first day." />
    {loading && !data && <section className="panel panel-body">Loading your current plan and usage…</section>}
    {error && <section className="panel panel-body" role="alert">{error}</section>}
    {notice && <section className="callout info" role="status"><Icon name="alert" size={16} /><span>{notice}</span>{paymentUrl && <a className="link" href={paymentUrl} target="_blank" rel="noopener noreferrer">Continue to PayPal</a>}</section>}
    {data && <>
      <section className="panel usage-plan"><div><span className="kpi-label">Current plan</span><h2>{data.plan.name}</h2><p className="muted">Status: {data.subscription.status}{data.subscription.billingInterval ? ` · one-time ${data.subscription.billingInterval} payment` : ''}{data.subscription.currentPeriodEnd ? ` · access through ${resetLabel(data.subscription.currentPeriodEnd)}` : ''}</p></div><span className="badge paid">{data.subscription.status === 'active' ? 'Active · no auto-renewal' : 'Free'}</span></section>
      <section className="usage-grid">{metrics.map(([key, title, description]) => {
        const item = data.usage[key], percent = Math.min(100, item.used / item.limit * 100), warning = percent >= 80;
        return <article className="panel usage-card" key={key}><div className="usage-card-head"><div><h2>{title}</h2><p>{description}</p></div><b className="num">{item.used.toLocaleString()} <span>/ {item.limit.toLocaleString()}</span></b></div><div className="usage-track" role="progressbar" aria-label={`${title} used`} aria-valuemin={0} aria-valuemax={item.limit} aria-valuenow={item.used}><span style={{ width: `${percent}%` }} /></div><small>{item.remaining.toLocaleString()} remaining this month{warning ? ' · 80% allowance warning' : ''}</small>{item.remaining === 0 && <p className="form-error">Monthly limit reached. Wait until {resetLabel(data.period.resetsAt)} UTC or request a paid plan. Payment options are below.</p>}</article>;
      })}</section>
      <section className="panel usage-period"><div><h2>{monthLabel(data.period.month)} allowance</h2><p>Usage resets at {resetLabel(data.period.resetsAt)} UTC. Annual payments receive the same monthly allowance.</p></div><div className="usage-capabilities"><span>{data.capabilities.workspaces.used} of {data.capabilities.workspaces.limit} workspace capacity</span><span>{data.capabilities.seats.used} of {data.capabilities.seats.limit} seat capacity</span><span>{data.capabilities.scenariosPerWorkspace.used} of {data.capabilities.scenariosPerWorkspace.limit} saved scenarios</span><span>{data.capabilities.forecastDays}-day Horizon</span><span>Monitor: {data.capabilities.monitor}</span></div><p className="muted">Morgan currently supports one workspace and one account member. Additional workspaces and team seats are not available yet.</p></section>
      <section className="panel section-gap"><div className="panel-head"><div><h2>Paid plan</h2><p>Pay with PayPal.Me · one-time payment · no automatic renewal.</p></div></div><p className="panel-body">Each button opens PayPal.Me with the selected USD amount. A monthly payment covers one month and an annual payment covers one year. Access ends on the displayed period end unless another payment is verified. After paying, return here to submit the PayPal account identifier and transaction ID; an administrator verifies the transaction before activating the plan.</p><label className="check-row policy-acceptance"><input type="checkbox" checked={purchaseAccepted} onChange={(e) => setPurchaseAccepted(e.target.checked)} /><span>I agree to the one-time payment and period terms, and have read the current <Link to="/policies/terms-of-use" target="_blank" rel="noreferrer">Terms of Use</Link>, <Link to="/policies/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</Link>, and <Link to="/policies/refund-policy" target="_blank" rel="noreferrer">Refund Policy</Link>.</span></label><div className="paypal-plan-grid">{(['pro','max'] as const).flatMap((planId) => (['monthly','annual'] as const).map((interval) => <article className="paypal-plan-option" key={`${planId}:${interval}`}><div className="paypal-plan-heading"><span><Icon name="spark" size={15} /> PREMIUM</span><b>{data.plans[planId].name} · {interval === 'annual' ? 'Annual' : 'Monthly'}</b></div><p className="paypal-plan-price">{money(interval === 'annual' ? data.plans[planId].annualCents : data.plans[planId].monthlyCents)} <small>USD · paid once</small></p><button className="paypal-pay-button" type="button" disabled={busy || !purchaseAccepted} onClick={() => void createCheckout(planId,interval)}><PayPalMark /><span>Pay with PayPal</span><Icon name="spark" size={18} className="paypal-premium-icon" /></button><small className="paypal-plan-term">{interval === 'annual' ? 'One year of access' : 'One month of access'} · no auto-renewal</small></article>))}</div><p className="muted panel-body">Morgan collects your PayPal username or account email and transaction ID only to match the payment. We delete PayPal username/email matching information within 90 days after submission. Never provide a password, security answer, verification code, card number, or bank credentials. PayPal.Me does not send Morgan automatic payment verification.</p></section>
      <section className="panel section-gap"><div className="panel-head"><div><h2>Payment history</h2><p>Pending payment requests stay inactive until Morgan confirms a completed USD payment to the intended merchant account.</p></div></div>{payments.loading && !payments.data ? <p className="panel-body">Loading payment requests…</p> : payments.error ? <p className="panel-body form-error">{payments.error}</p> : payments.data?.length ? <div className="table-wrap"><table className="table usage-payment-table"><thead><tr><th>Plan</th><th>Amount</th><th>Status</th><th>Transaction ID</th><th>PayPal confirmation</th></tr></thead><tbody>{payments.data.map((p) => <tr key={p.reference}><td>{p.planId} · {p.billingInterval}</td><td>{money(p.amountCents,p.currency)}</td><td>{p.status.replaceAll('_',' ')}</td><td>{p.transactionId || '—'}</td><td>{p.status === 'awaiting_payment' ? <form className="usage-payment-form" onSubmit={(e) => { e.preventDefault(); void submitTransaction(p.reference); }}><a className="link" href={p.paymentUrl} target="_blank" rel="noopener noreferrer">Continue to PayPal.Me</a><label><span>PayPal username or account email</span><input className="input" aria-label="PayPal username or account email" autoComplete="off" required minLength={3} maxLength={254} value={paymentDetails[p.reference]?.identifier || ''} onChange={(e) => setPaymentDetails({ ...paymentDetails, [p.reference]: { identifier: e.target.value, transactionId: paymentDetails[p.reference]?.transactionId || '' } })} placeholder="Username or email" /></label><label><span>PayPal transaction ID</span><input className="input" aria-label="PayPal transaction ID" autoComplete="off" required minLength={3} maxLength={120} value={paymentDetails[p.reference]?.transactionId || ''} onChange={(e) => setPaymentDetails({ ...paymentDetails, [p.reference]: { identifier: paymentDetails[p.reference]?.identifier || '', transactionId: e.target.value } })} placeholder="Transaction ID" /></label><button className="btn primary sm" disabled={busy}>Submit Payment for Verification</button></form> : p.status === 'pending_verification' || p.status === 'verifying' ? <span>Payment submitted — waiting for verification</span> : p.status === 'approved' ? 'Verified' : p.status}</td></tr>)}</tbody></table></div> : <p className="panel-body muted">No payment requests yet.</p>}</section>
      <section className="callout info section-gap"><Icon name="alert" size={16} /><span>Paid access is granted only after administrator verification. PayPal.Me does not support automatic payment verification or recurring subscriptions. Starter and paid plan limits remain consistent with the published plan configuration.</span><Link className="link" to="/pricing">Review plans</Link></section>
    </>}
  </>;
}

function PayPalMark() {
  return <svg className="paypal-mark" viewBox="0 0 36 28" aria-hidden="true" focusable="false"><text x="9" y="23" fill="#003087" fontFamily="Arial,sans-serif" fontSize="25" fontWeight="700">P</text><text x="3" y="19" fill="#009CDE" fontFamily="Arial,sans-serif" fontSize="25" fontWeight="700">P</text></svg>;
}
