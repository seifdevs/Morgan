import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, Marker, Wordmark, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';

const nav: { group?: string; items: { to: string; label: string; icon: string; end?: boolean }[] }[] = [
  { items: [{ to: '/app', label: 'Overview', icon: 'overview', end: true }] },
  { group: 'Money', items: [
    { to: '/app/transactions', label: 'Transactions', icon: 'transfer' },
    { to: '/app/invoices', label: 'Invoices', icon: 'document' },
    { to: '/app/receivables', label: 'Receivables', icon: 'receivable' },
    { to: '/app/bills', label: 'Bills', icon: 'payable' },
    { to: '/app/customers', label: 'Customers', icon: 'users' },
  ] },
  { group: 'Insights', items: [
    { to: '/app/spending', label: 'Spending', icon: 'pie' },
    { to: '/app/cashflow', label: 'Cash flow', icon: 'trend' },
    { to: '/app/reports', label: 'Reports', icon: 'report' },
    { to: '/app/insights', label: 'Cost insights', icon: 'spark' },
  ] },
  { group: 'Settings', items: [{ to: '/app/bank-accounts', label: 'Bank accounts', icon: 'cash' }] },
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
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  async function signOut() {
    try { await logout(); navTo('/login'); } catch (e) { toast((e as Error).message, 'error'); }
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
          <button onClick={signOut}><Icon name="logout" size={17} /><span>Log out</span></button>
        </div>
      </aside>
      <main className="main" id="main"><div className="route" key={loc.pathname}><Outlet /></div></main>
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
