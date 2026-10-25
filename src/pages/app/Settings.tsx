import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, Modal, PageHeader, useToast } from '../../components/ui';
import { api, type Business, type User } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/dates';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { centsToInput, toCents } from '../../../shared/money.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'EGP', 'AED', 'SAR', 'CHF', 'JPY'];

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}

export default function Settings() {
  useDocumentTitle('Settings');
  const { user, business, setSession } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const welcome = params.get('welcome');
  const biz = useSubmit(), prof = useSubmit(), pw = useSubmit();
  const sessions = useApi<{ current: boolean; createdAt: string; userAgent: string }[]>('/account/sessions');
  const [emailChanged, setEmailChanged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const del = useSubmit();

  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'start' });
  }, []);

  if (!user || !business) return null;

  const saveBusiness = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const opening = toCents(f.opening || '0');
    if (opening === null) return biz.setError('Opening balance must be an amount with at most 2 decimals');
    const tax = Number(f.tax || 0);
    if (!(tax >= 0 && tax <= 100)) return biz.setError('Default tax rate must be between 0 and 100');
    biz.run(async () => {
      const res = await api<{ business: Business }>('/business', { method: 'PATCH', body: {
        name: f.name, currency: f.currency, address: f.address, email: f.email, invoicePrefix: f.invoicePrefix,
        defaultTaxRateBps: Math.round(tax * 100), paymentTermsDays: Number(f.terms || 0), openingBalanceCents: opening, openingBalanceDate: f.openingDate || null, timezone: f.timezone,
      } });
      setSession({ business: res.business });
      toast('Business settings saved');
    });
  };

  const saveProfile = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    prof.run(async () => {
      const res = await api<{ user: User }>('/account', { method: 'PATCH', body });
      setSession({ user: res.user });
      setEmailChanged(false);
      toast('Profile saved');
    });
  };

  const changePassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (f.newPassword !== f.confirm) return pw.setError('New passwords do not match');
    pw.run(async () => {
      const res = await api<{ signedOut: number }>('/account/password', { method: 'POST', body: f });
      form.reset();
      sessions.reload();
      toast(`Password changed${res.signedOut ? ` · signed out ${res.signedOut} other session${res.signedOut > 1 ? 's' : ''}` : ''}`);
    });
  };

  async function revokeOthers() {
    try { const r = await api<{ signedOut: number }>('/account/sessions/revoke-others', { method: 'POST' }); toast(`Signed out ${r.signedOut} other session${r.signedOut === 1 ? '' : 's'}`); sessions.reload(); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  const deleteAccount = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get('password');
    del.run(async () => {
      await api('/account', { method: 'DELETE', body: { password } });
      setSession({ user: null, business: null });
      nav('/', { replace: true });
    });
  };

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" description="Your business profile, account and security." />
      <div className="settings-layout">
        <nav className="settings-index" aria-label="Settings sections">{[["business", "Business"], ["profile", "Profile"], ["password", "Password"], ["sessions", "Sessions"], ["delete", "Delete account"]].map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}</nav>
      <div className="settings">
        {welcome && (
          <div className="callout info"><Icon name="spark" size={16} /><span>Welcome to Morgan. Start by setting your opening cash balance below so your cash figures match your bank.</span></div>
        )}
        <section className="panel" id="business">
          <div className="panel-head"><h2>Business</h2><p>Appears on invoices and sets the currency for every figure.</p></div>
          <form className="panel-body" onSubmit={saveBusiness}>
            {biz.error && <div className="form-error" role="alert">{biz.error}</div>}
            <div className="form-grid two">
              <div className="field"><label htmlFor="b-name">Business name</label><input className="input" id="b-name" name="name" required maxLength={120} defaultValue={business.name} /></div>
              <div className="field"><label htmlFor="b-cur">Currency</label><select className="select" id="b-cur" name="currency" defaultValue={business.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                <span className="hint">Changing currency relabels figures; it does not convert amounts.</span></div>
            </div>
            <div className="form-grid two">
              <div className="field"><label htmlFor="b-email">Billing email</label><input className="input" id="b-email" name="email" type="email" defaultValue={business.email} /></div>
              <div className="field"><label htmlFor="b-addr">Address</label><textarea className="textarea" id="b-addr" name="address" maxLength={400} defaultValue={business.address} style={{ minHeight: 42 }} /></div>
            </div>
            <div className="form-grid two">
              <div className="field"><label htmlFor="b-prefix">Invoice number prefix</label><input className="input" id="b-prefix" name="invoicePrefix" required maxLength={12} defaultValue={business.invoicePrefix} /></div>
              <div className="form-grid two">
                <div className="field"><label htmlFor="b-tax">Default tax %</label><input className="input num" id="b-tax" name="tax" inputMode="decimal" defaultValue={business.defaultTaxRateBps / 100} /></div>
                <div className="field"><label htmlFor="b-terms">Terms (days)</label><input className="input num" id="b-terms" name="terms" type="number" min={0} max={365} defaultValue={business.paymentTermsDays} /></div>
              </div>
            </div>
            <div className="form-grid two">
              <div className="field"><label htmlFor="b-open">Opening cash balance</label><input className="input num" id="b-open" name="opening" inputMode="decimal" defaultValue={centsToInput(business.openingBalanceCents)} />
                <span className="hint">A manually entered estimate; no bank connection is active.</span></div>
              <div className="field"><label htmlFor="b-odate">As of date</label><input className="input" id="b-odate" name="openingDate" type="date" defaultValue={business.openingBalanceDate || ''} />
                <span className="hint">Cash on hand = this balance + transactions on or after this date.</span></div>
            </div>
            <div className="field"><label htmlFor="b-tz">Time zone</label>
              <select className="select" id="b-tz" name="timezone" defaultValue={business.timezone}>
                {[...new Set([business.timezone, ...Intl.supportedValuesOf('timeZone')])].map((z) => <option key={z}>{z}</option>)}
              </select>
              <span className="hint">Decides what “today” means for due dates, overdue status and projections.</span></div>
            <div className="form-actions"><button className="btn primary" disabled={biz.busy}>{biz.busy && <span className="spinner" />}Save business</button></div>
          </form>
        </section>

        <section className="panel" id="profile">
          <div className="panel-head"><h2>Profile</h2></div>
          <form className="panel-body" onSubmit={saveProfile}>
            {prof.error && <div className="form-error" role="alert">{prof.error}</div>}
            <div className="form-grid two">
              <div className="field"><label htmlFor="u-name">Name</label><input className="input" id="u-name" name="name" required maxLength={100} defaultValue={user.name} /></div>
              <div className="field"><label htmlFor="u-email">Email</label><input className="input" id="u-email" name="email" type="email" required defaultValue={user.email} onChange={(e) => setEmailChanged(e.target.value.trim().toLowerCase() !== user.email)} /></div>
            </div>
            {emailChanged && <div className="field"><label htmlFor="u-pw">Current password (required to change email)</label><input className="input" id="u-pw" name="currentPassword" type="password" autoComplete="current-password" required /></div>}
            <div className="form-actions"><button className="btn primary" disabled={prof.busy}>{prof.busy && <span className="spinner" />}Save profile</button></div>
          </form>
        </section>

        <section className="panel" id="password">
          <div className="panel-head"><h2>Password</h2><p>Changing your password signs you out everywhere else.</p></div>
          <form className="panel-body" onSubmit={changePassword}>
            {pw.error && <div className="form-error" role="alert">{pw.error}</div>}
            <div className="field"><label htmlFor="p-cur">Current password</label><input className="input" id="p-cur" name="currentPassword" type="password" autoComplete="current-password" required /></div>
            <div className="form-grid two">
              <div className="field"><label htmlFor="p-new">New password</label><input className="input" id="p-new" name="newPassword" type="password" autoComplete="new-password" required minLength={10} /><span className="hint">10+ characters with a letter and a number.</span></div>
              <div className="field"><label htmlFor="p-conf">Confirm new password</label><input className="input" id="p-conf" name="confirm" type="password" autoComplete="new-password" required /></div>
            </div>
            <div className="form-actions"><button className="btn primary" disabled={pw.busy}>{pw.busy && <span className="spinner" />}Change password</button></div>
          </form>
        </section>

        <section className="panel" id="sessions">
          <div className="panel-head"><h2>Active sessions</h2><button className="btn sm outline" onClick={revokeOthers} disabled={(sessions.data?.length || 0) < 2}>Sign out other sessions</button></div>
          <div className="panel-body" style={{ gap: 0 }}>
            {sessions.data?.map((s, i) => (
              <div key={i} className="session-row"><span>{describeAgent(s.userAgent)}{s.current && <span className="badge paid" style={{ marginLeft: 8 }}>This device</span>}</span><span className="muted">Signed in {formatDate(s.createdAt)}</span></div>
            ))}
          </div>
        </section>

        <section className="panel danger" id="delete">
          <div className="panel-head"><h2>Delete account</h2><p>Permanently deletes your login, business, and every transaction, invoice, customer and bill. This cannot be undone.</p></div>
          <div className="panel-body"><div className="form-actions" style={{ justifyContent: 'flex-start' }}><button className="btn danger" onClick={() => setDeleting(true)}>Delete account and data</button></div></div>
        </section>
      </div>
      </div>
      {deleting && (
        <Modal title="Delete your account?" description="All of your business data will be permanently removed." onClose={() => setDeleting(false)}
          footer={<><button className="btn outline" onClick={() => setDeleting(false)}>Cancel</button><button className="btn danger" form="del-form" disabled={del.busy}>{del.busy && <span className="spinner" />}Delete permanently</button></>}>
          <form id="del-form" className="form-grid" onSubmit={deleteAccount}>
            {del.error && <div className="form-error" role="alert">{del.error}</div>}
            <div className="field"><label htmlFor="d-pw">Confirm with your password</label><input className="input" id="d-pw" name="password" type="password" autoComplete="current-password" required /></div>
          </form>
        </Modal>
      )}
    </>
  );
}

function describeAgent(ua: string) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}
