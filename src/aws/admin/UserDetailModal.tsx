import { useState } from 'react';
import { X, Send, Power, PowerOff, LogOut, KeyRound, Trash2, AlertTriangle, Save } from 'lucide-react';
import type { AdminUser } from './adminApi';
import { setUserGroups, resendInvite, disableUser, enableUser, signOutUser, resetUserPassword, deleteUser, errorText } from './adminApi';

const MCD = 'ds-mule-mcd-01';

interface Props {
  user: AdminUser;
  datasets: string[];
  onClose: () => void;
  onChanged: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Attivo',
  FORCE_CHANGE_PASSWORD: 'Invitato',
  RESET_REQUIRED: 'Reset password',
  UNCONFIRMED: 'Non confermato',
  ARCHIVED: 'Archiviato',
  COMPROMISED: 'Compromesso',
  UNKNOWN: 'Sconosciuto',
};

function StatusBadge({ user }: { user: AdminUser }) {
  const cls = !user.enabled
    ? 'bg-slate-700/50 text-slate-400'
    : user.status === 'CONFIRMED'
      ? 'bg-emerald-500/15 text-emerald-400'
      : 'bg-amber-500/15 text-amber-400';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>
      {user.enabled ? (STATUS_LABEL[user.status] ?? user.status) : 'Disabilitato'}
    </span>
  );
}

/** Modal to manage a single user: groups, enable/disable, sign-out, reset, delete. */
export default function UserDetailModal({ user, datasets, onClose, onChanged }: Props) {
  const [groups, setGroups] = useState<Set<string>>(new Set(user.groups));
  const [confirmMcd, setConfirmMcd] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = ['admin', 'ds-all', ...datasets.map((d) => `ds-${d}`)];
  const groupLabel = (g: string) => (g === 'admin' ? 'Amministratore' : g === 'ds-all' ? 'Tutti i dataset' : g.slice(3));
  const sorted = (s: Iterable<string>) => [...s].sort().join(',');
  const dirty = sorted(groups) !== sorted(user.groups);
  const addingMcd = groups.has(MCD) && !user.groups.includes(MCD);

  const toggle = (g: string) =>
    setGroups((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const saveGroups = () => {
    if (addingMcd && !confirmMcd) return setError('Conferma l’accesso a mule-mcd-01.');
    void run(() => setUserGroups(user.key, [...groups], confirmMcd));
  };

  const action = (label: string, icon: React.ReactNode, fn: () => Promise<unknown>, danger = false) => (
    <button
      onClick={() => void run(fn)}
      disabled={busy}
      className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors disabled:opacity-40
        ${danger ? 'bg-rose-600/80 hover:bg-rose-500 text-white' : 'bg-slate-700/60 hover:bg-slate-600/60 text-slate-200'}`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-lg max-h-[88vh] flex flex-col animate-slide-up">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-700/50">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate" title={user.email}>{user.email}</h2>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge user={user} />
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {/* Groups */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Gruppi</p>
            <div className="space-y-1.5">
              {options.map((g) => (
                <label key={g} className="flex items-center gap-2.5 rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={groups.has(g)} onChange={() => toggle(g)} className="accent-amber-500" />
                  <span className="font-mono text-xs text-slate-500">{g}</span>
                  <span className="text-slate-300">{groupLabel(g)}</span>
                </label>
              ))}
            </div>
            {addingMcd && (
              <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span><b>mule-mcd-01</b> è materiale di terze parti.</span></p>
                <label className="mt-2 flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={confirmMcd} onChange={(e) => setConfirmMcd(e.target.checked)} className="accent-amber-500" />
                  Confermo l’accesso a mule-mcd-01
                </label>
              </div>
            )}
            <button
              onClick={saveGroups}
              disabled={busy || !dirty}
              className="btn-primary mt-3 flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40"
            >
              <Save className="w-4 h-4" /> Salva gruppi
            </button>
          </section>

          {/* Actions */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Azioni</p>
            <div className="grid grid-cols-2 gap-2">
              {action('Reinvita', <Send className="w-4 h-4" />, () => resendInvite(user.key))}
              {user.enabled
                ? action('Disabilita', <PowerOff className="w-4 h-4" />, () => disableUser(user.key))
                : action('Abilita', <Power className="w-4 h-4" />, () => enableUser(user.key))}
              {action('Sign-out ovunque', <LogOut className="w-4 h-4" />, () => signOutUser(user.key))}
              {action('Reset password', <KeyRound className="w-4 h-4" />, () => resetUserPassword(user.key))}
            </div>
          </section>

          {/* Delete */}
          <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-400 mb-2">Elimina utente</p>
            <p className="text-xs text-slate-400 mb-2">Scrivi l’e-mail per confermare. L’operazione non è reversibile.</p>
            <div className="flex gap-2">
              <input
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={user.email}
                className="input flex-1 text-sm"
              />
              <button
                onClick={() => void run(() => deleteUser(user.key))}
                disabled={busy || confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-3 text-sm font-semibold text-white transition-colors disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" /> Elimina
              </button>
            </div>
          </section>

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
