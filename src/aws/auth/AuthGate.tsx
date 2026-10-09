import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, WifiOff, RefreshCw, LogIn } from 'lucide-react';
import type { Session } from '../../types';
import { getSession, refreshSession, login, startSessionKeeper, OfflineError } from './session';
import { SessionContext, type AuthState } from './useSession';
import { setStorageUser } from '../../utils/storage';

/**
 * AWS build only. Renders its children once `/auth/me` confirms a session:
 *  - loading       → spinner while /auth/me (and possibly one /auth/refresh) runs
 *  - authenticated → children; refresh scheduled at exp - 5 min and on visibilitychange
 *  - offline       → the app shell came from the service-worker cache but the network is down:
 *                    banner + retry (hosted datasets need the network; the bundled one is hidden)
 *  - redirecting   → no valid session: full-page navigation to /auth/login?return=<path>
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const redirect = useCallback(() => { setState('redirecting'); login(); }, []);

  const check = useCallback(async () => {
    setState('loading');
    try {
      const s = (await getSession()) ?? (await refreshSession());
      if (!s) { redirect(); return; }
      setStorageUser(s.sub);
      setSession(s);
      setState('authenticated');
    } catch (e) {
      setDetail(e instanceof OfflineError ? null : e instanceof Error ? e.message : String(e));
      setState('offline');
    }
  }, [redirect]);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => {
    if (state !== 'authenticated') return;
    return startSessionKeeper(redirect);
  }, [state, redirect]);

  useEffect(() => {
    if (state !== 'offline') return;
    const retry = () => { void check(); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [state, check]);

  if (state === 'authenticated') {
    return <SessionContext.Provider value={{ state, session }}>{children}</SessionContext.Provider>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6 text-center animate-fade-in" data-auth-state={state}>
        {state === 'loading' && (
          <p className="flex items-center justify-center gap-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Verifica della sessione…</p>
        )}
        {state === 'redirecting' && (
          <p className="flex items-center justify-center gap-2 text-slate-400"><LogIn className="w-4 h-4" /> Reindirizzamento al login…</p>
        )}
        {state === 'offline' && (
          <>
            <div role="status" className="flex items-start gap-2 text-left text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
              <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Sei offline o il server non risponde. I dataset sono disponibili solo online, dopo l'accesso.
                {detail && <span className="block text-xs text-slate-500 mt-1 break-words">{detail}</span>}
              </span>
            </div>
            <button onClick={() => void check()} className="btn-secondary inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Riprova</button>
          </>
        )}
      </div>
    </div>
  );
}
