import { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '../../types';
import { currentSession, subscribeSession } from './session';

export type AuthState = 'loading' | 'authenticated' | 'offline' | 'redirecting';

export interface SessionContextValue {
  state: AuthState;
  session: Session | null;
}

export const SessionContext = /* @__PURE__ */ createContext<SessionContextValue>({ state: 'loading', session: null });

/** Current auth state and session (AWS build only; provided by AuthGate). */
export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

/** Session object kept in sync with refreshes. */
export function useLiveSession(): Session | null {
  const [s, setS] = useState<Session | null>(currentSession);
  useEffect(() => subscribeSession(setS), []);
  return s;
}

/** navigator.onLine, live. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
