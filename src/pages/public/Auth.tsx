import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, Wordmark } from '../../components/ui';
import { LedgerCover, LedgerTape } from '../../components/illustrations/Illustrations';
import { api, type Business, type User } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/hooks';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'EGP', 'AED', 'SAR', 'CHF', 'JPY'];
const rules = (pw: string) => [
  { ok: pw.length >= 10, label: '10+ characters' },
  { ok: /[A-Za-z]/.test(pw), label: 'A letter' },
  { ok: /\d/.test(pw), label: 'A number' },
  { ok: pw.length >= 14 || /[^A-Za-z0-9]/.test(pw), label: 'Bonus: symbol or 14+' },
];

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
    <div className={`auth ${kind}`}>
      {kind === 'login' ? <>{stage}{panel}</> : <>{panel}{stage}</>}
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
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (!loading && user) return <Navigate to={dest || next} replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setError('');
    if (signup && f.password !== f.confirm) { setError('Passwords do not match'); return; }
    if (signup && !rules(f.password).slice(0, 3).every((r) => r.ok)) { setError('Password needs 10+ characters, a letter and a number'); return; }
    setBusy(true);
    try {
      const res = await api<{ user?: User; business?: Business }>(signup ? '/auth/register' : '/auth/login', { method: 'POST', body: { ...f, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
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
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="field"><label htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required autoFocus /></div>
          <PasswordField id="password" name="password" label="Password" autoComplete="current-password" />
          {passwordResetAvailable && <Link className="link" style={{ justifySelf: 'start', fontSize: 13 }} to="/forgot-password">Forgot password?</Link>}
          <button className="btn primary lg" type="submit" disabled={busy}>{busy && <span className="spinner" />}{busy ? 'Signing in…' : 'Log in'}</button>
          <p className="auth-switch">New to Morgan? <Link className="link" to="/signup">Create an account</Link></p>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell kind="signup" stage={
      <aside className="auth-stage">
        <span className="folio stage-folio">Preview <b>nothing is saved until you submit</b></span>
        <LedgerCover name={form.name} business={form.businessName} currency={form.currency} strength={strength} />
        <p className="stage-caption">Your workspace starts empty. Every figure Morgan shows will come from records you add.</p>
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
        <PasswordField id="password" name="password" label="Password" autoComplete="new-password" value={form.password} onChange={set('password')} showRules />
        <PasswordField id="confirm" name="confirm" label="Confirm password" autoComplete="new-password" />
        <button className="btn primary lg" type="submit" disabled={busy}>{busy && <span className="spinner" />}{busy ? 'Opening your ledger…' : 'Create account'}</button>
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
