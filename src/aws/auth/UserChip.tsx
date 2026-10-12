import { useState } from 'react';
import { LogOut, User, WifiOff, ShieldCheck, Users } from 'lucide-react';
import { logout } from './session';
import { useLiveSession, useOnline } from './useSession';

/** Home header (AWS build): signed-in user, offline badge, "Admin" (admins only) and "Esci". */
export default function UserChip({ onAdmin }: { onAdmin?: () => void }) {
  const session = useLiveSession();
  const online = useOnline();
  const [leaving, setLeaving] = useState(false);
  if (!session) return null;
  return (
    <div className="w-full max-w-4xl flex items-center justify-end gap-2 mb-6 text-sm" data-testid="user-chip">
      {!online && (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400" data-testid="offline-badge">
          <WifiOff className="w-3.5 h-3.5" /> Offline
        </span>
      )}
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-slate-300" title={session.sub}>
        {session.adm ? <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-amber-400" /> : <User className="w-3.5 h-3.5 shrink-0 text-slate-500" />}
        <span className="truncate" data-testid="user-email">{session.email}</span>
      </span>
      {session.adm && onAdmin && (
        <button onClick={onAdmin} className="btn-ghost inline-flex shrink-0 items-center gap-1.5 px-3 py-1 text-sm" data-testid="admin-link">
          <Users className="w-4 h-4" /> Admin
        </button>
      )}
      <button
        onClick={() => { setLeaving(true); void logout(); }}
        disabled={leaving}
        className="btn-ghost inline-flex shrink-0 items-center gap-1.5 px-3 py-1 text-sm"
      >
        <LogOut className="w-4 h-4" /> Esci
      </button>
    </div>
  );
}
