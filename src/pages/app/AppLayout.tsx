import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, Marker, Wordmark, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import policies from '../../../shared/policies.json';

const nav: { group?: string; items: { to: string; label: string; icon: string; end?: boolean }[] }[] = [
  { items: [{ to: '/app', label: 'Dashboard', icon: 'overview', end: true }] },
  { items: [{ to: '/app/financial-core', label: 'Financial Core', icon: 'transfer' }] },
  { items: [{ to: '/app/monitor', label: 'Monitor', icon: 'alert' }] },
  { items: [{ to: '/app/horizon', label: 'Horizon', icon: 'trend' }] },
  { items: [{ to: '/app/reports', label: 'Reports', icon: 'report' }] },
];

/** Legacy /logout URL: ends the session server-side, then returns to the login screen. */
export function Logout() {
  const { logout } = useAuth();
  const navTo = useNavigate();
  useEffect(() => { logout().catch(() => {}).finally(() => navTo('/login', { replace: true })); }, [logout, navTo]);
  return <div className="boot" aria-busy="true"><span className="wordmark">mor<span>gan</span></span><span className="boot-bar" /></div>;
}

export function RequireAuth() {
  const { user, business, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="boot" aria-busy="true"><span className="wordmark">mor<span>gan</span></span><span className="boot-bar" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (business?.financialSetupComplete === false && loc.pathname !== '/app/onboarding') return <Navigate to="/app/onboarding" replace />;
  return <AppLayout />;
}

function AppLayout() {
  const { user, business, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navTo = useNavigate();
  const toast = useToast();
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyMissing, setPolicyMissing] = useState<{ id: string; label: string; slug: string; version: string }[]>([]);
  const [policyChecks, setPolicyChecks] = useState<Record<string, boolean>>({});
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState('');
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    let active = true;
    api<{ missing: typeof policyMissing }>('/account/policies/status').then((result) => { if (active) setPolicyMissing(result.missing); }).catch((error) => { if (active) setPolicyError((error as Error).message); }).finally(() => { if (active) setPolicyLoading(false); });
    return () => { active = false; };
  }, [user?.id]);

  async function signOut() {
    try { await logout(); navTo('/login'); } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function acceptPolicies() {
    setPolicyError('');
    if (!policies.every(({ id }) => policyChecks[id])) { setPolicyError('Select each policy to confirm acceptance.'); return; }
    setPolicySaving(true);
    try {
      await api('/account/policies/accept', { method: 'POST', body: { acceptedPolicies: policies.map(({ id, version }) => ({ policyId: id, version })) } });
      setPolicyMissing([]);
    } catch (error) { setPolicyError((error as Error).message); }
    finally { setPolicySaving(false); }
  }

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <button className="btn ghost icon sm" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
        <Wordmark to="/app" />
        <NavLink className="btn primary icon sm" to="/app/invoices/new" aria-label="New invoice"><Icon name="plus" /></NavLink>
      </header>
      <div className="scrim" onClick={() => setOpen(false)} />
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sb-head">
          <Wordmark to="/app" />
          <button className="btn ghost icon sm sb-close" aria-label="Close navigation" onClick={() => setOpen(false)}><Icon name="close" /></button>
        </div>
        <div className="sb-biz">
          <span className="sb-mono">{business?.name.slice(0, 1).toUpperCase()}</span>
          <span><b>{business?.name}</b><small>{business?.currency} · {user?.email}</small></span>
        </div>
        <NavLink className="btn primary sb-new" to="/app/invoices/new"><Icon name="plus" size={16} /> New invoice</NavLink>
        <nav className="sb-nav">
          {nav.map((g, i) => (
            <div key={i} className="sb-group">
              {g.group && <div className="sb-label">{g.group}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end}>{({ isActive }) => <>{isActive && <Marker id="sb-marker" className="sb-marker" />}<Icon name={it.icon} size={17} /><span>{it.label}</span></>}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          {user?.role === 'admin' && <NavLink to="/admin"><Icon name="settings" size={17} /><span>Admin</span></NavLink>}
          <NavLink to="/app/settings">{({ isActive }) => <>{isActive && <Marker id="sb-marker" className="sb-marker" />}<Icon name="settings" size={17} /><span>Settings</span></>}</NavLink>
          <NavLink to="/app/usage">{({ isActive }) => <>{isActive && <Marker id="sb-marker" className="sb-marker" />}<Icon name="report" size={17} /><span>Plan & usage</span></>}</NavLink>
          <button onClick={signOut}><Icon name="logout" size={17} /><span>Log out</span></button>
        </div>
      </aside>
      <main className="main" id="main">{business?.isDemo && <div className="demo-banner"><b>SIMULATED DEMO WORKSPACE</b><span>All people, businesses, transactions, balances, and plans shown here are fictional sample data.</span></div>}{policyLoading ? <section className="panel panel-body">Checking current policies…</section> : policyMissing.length ? <section className="panel policy-renewal"><span className="eyebrow">Policy update / acknowledgement required</span><h1>Review Morgan’s current policies</h1><p>To continue using Morgan, review and accept each current policy. Your acceptance is recorded with the document version and time.</p>{policyError && <div className="form-error" role="alert">{policyError}</div>}{policyMissing.map((item) => <label className="check-row" key={item.id}><input type="checkbox" checked={!!policyChecks[item.id]} onChange={(event) => setPolicyChecks({ ...policyChecks, [item.id]: event.target.checked })} /><span>I have read and agree to the current <a href={`/policies/${item.slug}`} target="_blank" rel="noreferrer">{item.label}</a> (version {item.version}).</span></label>)}<button className="btn primary" disabled={policySaving} onClick={() => void acceptPolicies()}>{policySaving ? 'Saving acceptance…' : 'Accept current policies'}</button></section> : policyError ? <section className="panel panel-body form-error" role="alert">Could not check policy acceptance: {policyError}. Refresh to try again.</section> : <div className="route" key={loc.pathname}><Outlet /></div>}</main>
    </div>
  );
}

export function RequireAdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="boot" aria-busy="true"><span className="wordmark">mor<span>gan</span></span><span className="boot-bar" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (user.role !== 'admin') return <Navigate to="/app" replace />;
  return <>{children}</>;
}
