import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, Wordmark } from '../../components/ui';
import { LedgerCover, LedgerTape } from '../../components/illustrations/Illustrations';
import { api, type Business, type User } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/hooks';
import { PublicFooter } from './PublicLayout';
import policies from '../../../shared/policies.json';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'EGP', 'AED', 'SAR', 'CHF', 'JPY'];
const rules = (pw: string) => [
  { ok: pw.length >= 10, label: '10+ characters' },
  { ok: /[A-Za-z]/.test(pw), label: 'A letter' },
  { ok: /\d/.test(pw), label: 'A number' },
  { ok: pw.length >= 14 || /[^A-Za-z0-9]/.test(pw), label: 'Bonus: symbol or 14+' },
];
type RegistrationStatementPreview = { rows: { date: string; description: string; amountCents: number; currency: string; runningBalanceCents: number | null; sourceRowNumber: number; duplicate: boolean }[]; summary: { count: number; duplicates: number; periodStart: string; periodEnd: string; creditsCents: number; debitsCents: number } };

function PasswordField({ id, name, label, autoComplete, value, onChange, showRules }: {
  id: string; name: string; label: string; autoComplete: string; value?: string; onChange?: (v: string) => void; showRules?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input className="input" id={id} name={name} type={show ? 'text' : 'password'} autoComplete={autoComplete} required maxLength={200}
          value={value} onChange={onChange && ((e) => onChange(e.target.value))} aria-describedby={showRules ? `${id}-rules` : undefined} />
        <button type="button" className="btn ghost sm" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {showRules && <ul className="pw-rules" id={`${id}-rules`}>{rules(value || '').map((r) => <li key={r.label} className={r.ok ? 'ok' : ''}>{r.label}</li>)}</ul>}
    </div>
  );
}

function AuthShell({ kind, stage, children }: { kind: 'login' | 'signup'; stage: ReactNode; children: ReactNode }) {
  const panel = (
    <main className="auth-panel" id="main">
      <div className="auth-top">{kind === 'signup' ? <Wordmark /> : <span className="hide-wide"><Wordmark /></span>}<Link className="link" to="/"><Icon name="arrowLeft" size={15} className="arrow back-arrow" />Back to site</Link></div>
      {children}
    </main>
  );
  return (
    <div className="auth-document">
      <div className={`auth ${kind}`}>
        {kind === 'login' ? <>{stage}{panel}</> : <>{panel}{stage}</>}
      </div>
      <PublicFooter />
    </div>
  );
}

function LoginStage({ headline, sub }: { headline: ReactNode; sub: string }) {
  return (
    <aside className="auth-stage" aria-hidden="true">
      <Wordmark size="lg" />
      <div className="login-tape"><LedgerTape vertical /></div>
      <div className="login-headline"><p>{headline}</p><small>{sub}</small></div>
    </aside>
  );
}

export function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const signup = mode === 'signup';
  useDocumentTitle(signup ? 'Create a Morgan account' : 'Log in to Morgan', signup ? 'Create a Morgan workspace to organize business finances and review your cash flow.' : 'Sign in to your Morgan financial workspace.', { indexable: false });
  const { user, setSession, loading, passwordResetAvailable } = useAuth();
  const loc = useLocation();
  const next = (loc.state as { from?: string } | null)?.from || '/app';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', businessName: '', currency: 'USD', password: '' });
  const [country, setCountry] = useState('');
  const [bankQuery, setBankQuery] = useState('');
  const [banks, setBanks] = useState<{ id: string; name: string; state: string }[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState('');
  const [bankId, setBankId] = useState('');
  const [statementFile, setStatementFile] = useState<{ name: string; base64: string } | null>(null);
  const [statementChoiceName, setStatementChoiceName] = useState('');
  const [statementPreview, setStatementPreview] = useState<RegistrationStatementPreview | null>(null);
  const [statementReviewed, setStatementReviewed] = useState(false);
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [verificationPending, setVerificationPending] = useState<{ email: string; status: string; message?: string | null } | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (!signup || country !== 'US') { setBanks([]); setBanksLoading(false); setBanksError(''); return; }
    let active = true;
    setBanksLoading(true); setBanksError('');
    const timer = window.setTimeout(() => api<{ banks: { id: string; name: string; state: string }[] }>(`/bank-directory?country=US&q=${encodeURIComponent(bankQuery)}`).then((r) => { if (active) setBanks(r.banks); }).catch((error) => { if (active) { setBanks([]); setBanksError((error as Error).message); } }).finally(() => { if (active) setBanksLoading(false); }), 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [signup, country, bankQuery]);

  if (!loading && user) return <Navigate to={dest || next} replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setError('');
    if (signup && f.password !== f.confirm) { setError('Passwords do not match'); return; }
    if (signup && !rules(f.password).slice(0, 3).every((r) => r.ok)) { setError('Password needs 10+ characters, a letter and a number'); return; }
    setBusy(true);
    try {
      if (signup && !statementPreview) {
        const file = (e.currentTarget.elements.namedItem('statement') as HTMLInputElement)?.files?.[0];
        if (file) {
          if (!country || !bankId) throw new Error('Choose the bank and country for the statement you want to import.');
          if (!['application/pdf', 'text/csv', 'application/vnd.ms-excel', ''].includes(file.type) && !/\.(pdf|csv|xlsx)$/i.test(file.name)) throw new Error('Upload a PDF, CSV, or XLSX bank statement.');
          const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('The statement file could not be read.')); reader.readAsDataURL(file); });
          const parsed = await api<RegistrationStatementPreview>('/auth/statement-preview', { method: 'POST', body: { filename: file.name, sourceFileBase64: base64, currency: 'USD' } });
          if (!parsed.rows.length) throw new Error('No transactions were found in this statement.');
          setStatementFile({ name: file.name, base64 }); setStatementPreview(parsed); setStatementReviewed(false); setBusy(false); return;
        }
      }
      if (signup && statementPreview && !statementReviewed) throw new Error('Review the statement rows and confirm before continuing.');
      if (signup && statementPreview && !currencyConfirmed) throw new Error('Confirm that the uploaded statement uses USD.');
      if (signup && !policyAccepted) throw new Error('Accept the current Morgan policies before creating your account.');
      const includeStatement = signup && Boolean(statementPreview && statementFile);
      const res = await api<{ user?: User; business?: Business; verificationRequired?: boolean; emailStatus?: string; emailMessage?: string | null }>(signup ? '/auth/register' : '/auth/login', { method: 'POST', body: { ...f, ...(signup && { currency: includeStatement ? 'USD' : form.currency, ...(includeStatement && { country, bankId, statementCurrencyConfirmed: currencyConfirmed, statementFilename: statementFile?.name, statementFileBase64: statementFile?.base64, statementReviewed, duplicatesReviewed: statementReviewed, openingBalanceCents: new FormData(e.currentTarget).get('openingBalance'), closingBalanceCents: new FormData(e.currentTarget).get('closingBalance') }), acceptedPolicies: policies.map(({ id, version }) => ({ policyId: id, version })) }), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      if (signup && res.verificationRequired) {
        setVerificationPending({ email: f.email, status: res.emailStatus || 'unknown', message: res.emailMessage });
        setBusy(false);
        return;
      }
      if (!res.user || !res.business) throw new Error('The server returned an incomplete sign-in response.');
      setDest(signup ? '/app/onboarding' : next);
      setSession({ user: res.user, business: res.business });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const strength = rules(form.password).filter((r) => r.ok).length;
  const step = !form.name || !form.businessName ? 0 : strength < 3 ? 1 : 2;

  if (!signup) {
    return (
      <AuthShell kind="login" stage={<LoginStage headline={<>Welcome<br /><span>back.</span></>} sub="Your ledger is exactly where you left it — every figure tied to the record behind it." />}>
        <form className="auth-form" onSubmit={submit}>
          <h1>Open your ledger</h1>
          {error && <div className="form-error" role="alert">{error}{error.toLowerCase().includes('verify your email') && <> <Link className="link" to="/verify-email">Request a verification email</Link></>}</div>}
          <div className="field"><label htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required autoFocus /></div>
          <PasswordField id="password" name="password" label="Password" autoComplete="current-password" />
          {passwordResetAvailable && <Link className="link" style={{ justifySelf: 'start', fontSize: 13 }} to="/forgot-password">Forgot password?</Link>}
          <button className="btn primary lg" type="submit" disabled={busy}>{busy && <span className="spinner" />}{busy ? 'Signing in…' : 'Log in'}</button>
          <p className="auth-switch">New to Morgan? <Link className="link" to="/signup">Create an account</Link></p>
        </form>
      </AuthShell>
    );
  }

  if (verificationPending) {
    const accepted = verificationPending.status === 'accepted';
    return <AuthShell kind="signup" stage={<aside className="auth-stage"><span className="folio stage-folio">Almost there</span><LedgerCover name={form.name} business={form.businessName} currency={form.currency} strength={strength} /><p className="stage-caption">Verify your email to unlock your Morgan workspace.</p></aside>}>
      <div className="auth-form"><h1>Check your email</h1><p>We created your account for <b>{verificationPending.email}</b>. Verify the address before signing in.</p>
        <div className={accepted ? 'auth-success' : 'form-error'} role="status">{accepted ? 'Resend accepted the verification email request. Inbox delivery is not confirmed.' : verificationPending.message || 'The account is saved, but Resend could not accept the verification email yet.'}</div>
        <p className="muted">The link expires in 24 hours and works once. If it does not arrive, you can request another message below.</p>
        <ResendVerification initialEmail={verificationPending.email} />
        <p className="auth-switch">Already verified? <Link className="link" to="/login">Log in</Link></p>
      </div>
    </AuthShell>;
  }

  return (
    <AuthShell kind="signup" stage={
      <aside className="auth-stage">
        <span className="folio stage-folio">Preview <b>nothing is saved until you submit</b></span>
        <LedgerCover name={form.name} business={form.businessName} currency={form.currency} strength={strength} />
        <p className="stage-caption">Upload a statement to start with reviewed records, or create an empty workspace and add records later.</p>
      </aside>
    }>
      <form className="auth-form" onSubmit={submit}>
        <h1>Create your Morgan account</h1>
        <div className="signup-steps" aria-hidden="true">
          <span className={step >= 0 ? 'on' : ''}>01 You</span><span className={step >= 1 ? 'on' : ''}>02 Security</span><span className={step >= 2 ? 'on' : ''}>03 Ready</span>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-grid two">
          <div className="field"><label htmlFor="name">Your name</label><input className="input" id="name" name="name" autoComplete="name" required maxLength={100} value={form.name} onChange={(e) => set('name')(e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="businessName">Business name</label><input className="input" id="businessName" name="businessName" autoComplete="organization" required maxLength={120} value={form.businessName} onChange={(e) => set('businessName')(e.target.value)} /></div>
        </div>
        <div className="form-grid two">
          <div className="field"><label htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
          <div className="field"><label htmlFor="currency">Currency</label><select className="select" id="currency" name="currency" value={form.currency} onChange={(e) => set('currency')(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="form-grid two">
          <div className="field"><label htmlFor="signup-country">Statement country <span className="muted">(optional)</span></label><select className="select" id="signup-country" value={country} onChange={(e) => { setCountry(e.target.value); setBankId(''); setStatementPreview(null); setStatementFile(null); setStatementReviewed(false); setCurrencyConfirmed(false); }}><option value="">Select only if importing a statement</option><option value="US">United States</option></select><span className="hint">Only needed when you choose to import a bank statement.</span></div>
          <div className="field"><label htmlFor="signup-currency">Workspace currency</label><input className="input" id="signup-currency" value={statementChoiceName ? 'USD for statement import' : form.currency} readOnly /><span className="hint">{statementChoiceName ? 'Statement imports require USD, so this workspace will use USD.' : 'Without a statement import, Morgan uses the workspace currency selected above.'}</span></div>
        </div>
        <div className="form-grid two">
          <div className="field"><label htmlFor="bank-search">Bank for statement <span className="muted">(optional)</span></label><input className="input" id="bank-search" value={bankQuery} onChange={(e) => { setBankQuery(e.target.value); setBankId(''); setStatementPreview(null); }} placeholder="Search FDIC’s top 100 by assets" disabled={country !== 'US'} /><select className="select" aria-label="Select bank for statement import" value={bankId} onChange={(e) => { setBankId(e.target.value); setStatementPreview(null); }} disabled={country !== 'US' || banksLoading}><option value="">{banksLoading ? 'Loading bank directory…' : 'Select a bank if importing a statement'}</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.state}</option>)}</select><span className="hint">{banksError || 'Only needed when importing a statement.'}</span></div>
        <div className="field"><label htmlFor="statement">Bank statement <span className="muted">(optional)</span></label><input className="input" id="statement" name="statement" type="file" accept=".pdf,.csv,.xlsx,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setStatementChoiceName(e.target.files?.[0]?.name || ''); setStatementPreview(null); setStatementReviewed(false); setCurrencyConfirmed(false); setStatementFile(null); }} /><span className="hint">You can create your account without uploading one. To import now: PDF, CSV, or XLSX, maximum 10 MB. Scanned image-only PDFs are not supported.</span></div>
        </div>
        {statementPreview && <section className="panel statement-signup-review" aria-label="Statement review">
          <h2>Review extracted statement</h2><p className="muted">{statementFile?.name} · {statementPreview.summary.count} transactions · {statementPreview.summary.periodStart} to {statementPreview.summary.periodEnd}. These rows were extracted from the uploaded file. {statementPreview.summary.duplicates ? `${statementPreview.summary.duplicates} repeated rows will be skipped.` : 'No repeated rows detected.'}</p>
          <div className="form-grid two"><div className="field"><label htmlFor="registration-opening">Statement opening balance (USD)</label><input className="input num" id="registration-opening" name="openingBalance" required inputMode="decimal" placeholder="0.00" /></div><div className="field"><label htmlFor="registration-closing">Statement closing balance (USD)</label><input className="input num" id="registration-closing" name="closingBalance" required inputMode="decimal" placeholder="0.00" /></div></div>
          <div className="table-wrap signup-statement-table"><table className="table"><thead><tr><th>Date</th><th>Description</th><th className="r">Amount</th><th className="r">Balance</th></tr></thead><tbody>{statementPreview.rows.slice(0, 200).map((r, i) => <tr key={`${r.sourceRowNumber}-${i}`}><td>{r.date}</td><td>{r.description}{r.duplicate && <small className="sub">Repeated row · will skip</small>}</td><td className="r num">${(r.amountCents / 100).toFixed(2)}</td><td className="r num">{r.runningBalanceCents === null ? '—' : `$${(r.runningBalanceCents / 100).toFixed(2)}`}</td></tr>)}</tbody></table>{statementPreview.rows.length > 200 && <p className="hint">Showing first 200 rows; all {statementPreview.rows.length} extracted records will be validated on submission.</p>}</div>
          <label className="check-row"><input type="checkbox" checked={statementReviewed} onChange={(e) => setStatementReviewed(e.target.checked)} /><span>I reviewed these extracted transactions and entered the opening and closing balances shown on the statement.</span></label>
          <label className="check-row"><input type="checkbox" checked={currencyConfirmed} onChange={(e) => setCurrencyConfirmed(e.target.checked)} /><span>I confirmed this bank statement is denominated in US dollars (USD).</span></label>
        </section>}
        <PasswordField id="password" name="password" label="Password" autoComplete="new-password" value={form.password} onChange={set('password')} showRules />
        <PasswordField id="confirm" name="confirm" label="Confirm password" autoComplete="new-password" />
        <label className="check-row policy-acceptance"><input type="checkbox" checked={policyAccepted} onChange={(e) => setPolicyAccepted(e.target.checked)} required={!statementChoiceName || !!statementPreview} /><span>I have read and agree to Morgan's <Link to="/policies/terms-of-use" target="_blank" rel="noreferrer">Terms of Use</Link>, <Link to="/policies/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</Link>, and <Link to="/policies/refund-policy" target="_blank" rel="noreferrer">Refund Policy</Link>.</span></label>
        <button className="btn primary lg" type="submit" disabled={busy || (!statementChoiceName && !policyAccepted) || (statementPreview !== null && (!statementReviewed || !currencyConfirmed || !policyAccepted))}>{busy && <span className="spinner" />}{busy ? (statementPreview ? 'Creating secure workspace…' : statementChoiceName ? 'Reading statement…' : 'Creating account…') : statementPreview ? 'Create account with statement' : statementChoiceName ? 'Review statement' : 'Create account'}</button>
        <p className="auth-switch">Already have an account? <Link className="link" to="/login">Log in</Link></p>
      </form>
    </AuthShell>
  );
}

function ResendVerification({ initialEmail = '' }: { initialEmail?: string }) {
  const [emailValue, setEmailValue] = useState(initialEmail);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [canRetry, setCanRetry] = useState(true);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setStatus('');
    try {
      const result = await api<{ emailStatus: 'accepted' | 'rejected' | 'failed' | 'unknown'; emailMessage?: string; retryable?: boolean }>('/auth/resend-verification', { method: 'POST', body: { email: emailValue } });
      setStatus(result.emailMessage || (result.emailStatus === 'accepted' ? 'Resend accepted the verification request. Inbox delivery is not confirmed.' : result.emailStatus === 'unknown' ? 'If that address has an unverified account, a request may be processed.' : 'Verification email delivery is temporarily unavailable. You can retry later.'));
      if (result.emailStatus === 'rejected' || result.emailStatus === 'failed') setCanRetry(Boolean(result.retryable));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="form-grid" onSubmit={submit}><label className="sr-only" htmlFor="resend-email">Email address</label><input className="input" id="resend-email" type="email" required value={emailValue} onChange={(e) => setEmailValue(e.target.value)} placeholder="Email address" />{error && <span className="form-error" role="alert">{error}</span>}{status && <span className="muted" role="status">{status}</span>}{canRetry && <button className="btn outline" disabled={busy}>{busy ? 'Requesting…' : 'Resend verification email'}</button>}</form>;
}

export function VerifyEmail() {
  useDocumentTitle('Verify your email', 'Complete email verification for your Morgan account.', { indexable: false });
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<'busy' | 'verified' | 'error'>(token ? 'busy' : 'error');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!token) { setMessage('This link is missing its verification token. Request a fresh one below.'); return; }
    api<{ welcomeEmail: { status: string } }>('/auth/verify-email', { method: 'POST', body: { token } })
      .then((result) => { setState('verified'); setMessage(result.welcomeEmail.status === 'accepted' ? 'Your address is verified. Resend accepted the welcome email request; inbox delivery is not confirmed.' : result.welcomeEmail.status === 'rejected' ? 'Your address is verified. Resend rejected the welcome email request.' : result.welcomeEmail.status === 'unknown' ? 'Your address is verified. Morgan could not confirm whether the welcome email was accepted.' : 'Your address is verified. The welcome email could not be sent.'); })
      .catch((err) => { setState('error'); setMessage((err as Error).message); });
  }, [token]);
  return <AuthShell kind="login" stage={<LoginStage headline={<>Your email,<br /><span>secured.</span></>} sub="Email verification helps protect access to your Morgan workspace." />}><div className="auth-form"><h1>{state === 'busy' ? 'Verifying your email…' : state === 'verified' ? 'Email verified' : 'Verification needed'}</h1>{message && <div className={state === 'verified' ? 'auth-success' : 'form-error'} role="status">{message}</div>}{state === 'verified' ? <p className="auth-switch"><Link className="link" to="/login">Continue to log in</Link></p> : <><p className="muted">Verification links expire after 24 hours and work once. A duplicate or expired link needs a new message.</p><ResendVerification /></>}</div></AuthShell>;
}

export function ForgotPassword() {
  useDocumentTitle('Reset your Morgan password', 'Request a secure password reset link for your Morgan account.', { indexable: false });
  const { passwordResetAvailable, loading } = useAuth();
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState('busy'); setError('');
    try { await api('/auth/forgot', { method: 'POST', body: { email: new FormData(e.currentTarget).get('email') } }); setState('sent'); }
    catch (err) { setError((err as Error).message); setState('idle'); }
  }
  return (
    <AuthShell kind="login" stage={<LoginStage headline={<>Locked<br /><span>out?</span></>} sub="Reset links are single-use, expire after 30 minutes, and sign out every device." />}>
      <div className="auth-form">
        <h1>Reset your password</h1>
        {!loading && !passwordResetAvailable ? (
          <div className="callout"><span>Password reset by email isn’t configured on this server. If you’re signed in elsewhere, change your password in Settings; otherwise contact the workspace administrator.</span></div>
        ) : state === 'sent' ? (
          <div className="auth-success" role="status"><b>Reset request processed.</b><span className="muted">If an account exists for that address, Morgan processed the request. Email acceptance and inbox delivery are not confirmed. A reset link, if sent, expires in 30 minutes. You can request another link if needed.</span></div>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="field"><label htmlFor="email">Account email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required autoFocus /></div>
            <button className="btn primary lg" disabled={state === 'busy'}>{state === 'busy' && <span className="spinner" />}Send reset link</button>
          </form>
        )}
        <p className="auth-switch"><Link className="link" to="/login"><Icon name="arrowLeft" size={15} className="arrow back-arrow" />Back to log in</Link></p>
      </div>
    </AuthShell>
  );
}

export function ResetPassword() {
  useDocumentTitle('Choose a new Morgan password', 'Choose a new password for your Morgan account.', { indexable: false });
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const token = params.get('token') || '';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const confirm = new FormData(e.currentTarget).get('confirm');
    if (pw !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true); setError('');
    try { await api('/auth/reset', { method: 'POST', body: { token, password: pw } }); nav('/login', { replace: true, state: { reset: true } }); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <AuthShell kind="login" stage={<LoginStage headline={<>A fresh<br /><span>key.</span></>} sub="After you save, every existing session is signed out." />}>
      <form className="auth-form" onSubmit={submit}>
        <h1>Choose a new password</h1>
        {!token && <div className="form-error" role="alert">This link is missing its reset token. Request a new link.</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <PasswordField id="password" name="password" label="New password" autoComplete="new-password" value={pw} onChange={setPw} showRules />
        <PasswordField id="confirm" name="confirm" label="Confirm new password" autoComplete="new-password" />
        <button className="btn primary lg" disabled={busy || !token}>{busy && <span className="spinner" />}Save new password</button>
        <p className="auth-switch"><Link className="link" to="/forgot-password">Request a new link</Link></p>
      </form>
    </AuthShell>
  );
}
