import { useState, type FormEvent, type ReactNode } from 'react';
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
  useDocumentTitle(signup ? 'Create account' : 'Log in');
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
      const res = await api<{ user: User; business: Business }>(signup ? '/auth/register' : '/auth/login', { method: 'POST', body: { ...f, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
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

export function ForgotPassword() {
  useDocumentTitle('Reset password');
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
          <div className="auth-success" role="status"><b>Check your inbox.</b><span className="muted">If an account exists for that address, a reset link is on its way. It expires in 30 minutes.</span></div>
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
  useDocumentTitle('Choose a new password');
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
