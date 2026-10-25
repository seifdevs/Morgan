import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Business, type User } from './api';

type Session = { user: User | null; business: Business | null; mailConfigured: boolean; passwordResetAvailable?: boolean };
type AuthCtx = Session & {
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (s: Partial<Session>) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setState] = useState<Session>({ user: null, business: null, mailConfigured: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<Session>('/auth/me');
      setState({ user: me.user, business: me.business ?? null, mailConfigured: !!me.mailConfigured, passwordResetAvailable: !!me.passwordResetAvailable });
    } catch {
      setState({ user: null, business: null, mailConfigured: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setState((p) => ({ ...p, user: null, business: null }));
    window.addEventListener('morgan:unauthorized', onUnauthorized);
    return () => window.removeEventListener('morgan:unauthorized', onUnauthorized);
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setState((p) => ({ ...p, user: null, business: null }));
  }, []);

  const setSession = useCallback((s: Partial<Session>) => setState((p) => ({ ...p, ...s })), []);

  return <Ctx.Provider value={{ ...session, loading, refresh, setSession, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
