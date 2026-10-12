import { useState } from 'react';
import { X, Send, AlertTriangle } from 'lucide-react';
import { inviteUser, errorText } from './adminApi';

const MCD = 'ds-mule-mcd-01';

interface Props {
  datasets: string[];
  onClose: () => void;
  onDone: () => void;
}

/** Modal to invite a user (Cognito AdminCreateUser) and pick their groups. */
export default function InviteModal({ datasets, onClose, onDone }: Props) {
  const [email, setEmail] = useState('');
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [confirmMcd, setConfirmMcd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = ['admin', 'ds-all', ...datasets.map((d) => `ds-${d}`)];
  const wantsMcd = groups.has(MCD);
  const toggle = (g: string) =>
    setGroups((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  const groupLabel = (g: string) =>
    g === 'admin' ? 'Amministratore' : g === 'ds-all' ? 'Tutti i dataset' : g.slice(3);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError('Inserisci un’e-mail.');
    if (wantsMcd && !confirmMcd) return setError('Conferma l’accesso a mule-mcd-01.');
    setBusy(true);
    try {
      await inviteUser(email.trim(), [...groups], confirmMcd);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <form onSubmit={submit} className="card w-full max-w-md p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Invita utente</h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">E-mail</label>
        <input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="collega@example.com"
          className="input mb-4"
        />

        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Gruppi</p>
        <div className="space-y-1.5 mb-4">
          {options.map((g) => (
            <label key={g} className="flex items-center gap-2.5 rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2 text-sm cursor-pointer">
              <input type="checkbox" checked={groups.has(g)} onChange={() => toggle(g)} className="accent-amber-500" />
              <span className="font-mono text-xs text-slate-500">{g}</span>
              <span className="text-slate-300">{groupLabel(g)}</span>
            </label>
          ))}
        </div>

        {wantsMcd && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            <p className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span><b>mule-mcd-01</b> contiene materiale d’esame di terze parti: concedilo consapevolmente.</span>
            </p>
            <label className="mt-2 flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={confirmMcd} onChange={(e) => setConfirmMcd(e.target.checked)} className="accent-amber-500" />
              Confermo di voler dare accesso a mule-mcd-01
            </label>
          </div>
        )}

        {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Annulla</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1 flex items-center justify-center gap-2">
            <Send className="w-4 h-4" /> {busy ? 'Invio…' : 'Invita'}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Cognito invia un’e-mail con password temporanea (valida 7 giorni). Gruppi senza <span className="font-mono">ds-*</span>/<span className="font-mono">ds-all</span>/<span className="font-mono">admin</span> non danno accesso.
        </p>
      </form>
    </div>
  );
}
