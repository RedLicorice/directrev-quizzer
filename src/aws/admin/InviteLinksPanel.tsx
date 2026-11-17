import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Copy, Check, AlertTriangle, Ban } from 'lucide-react';
import type { CreatedInviteLink, InviteLink, InviteLinkDefaults } from './adminApi';
import { listInviteLinks, createInviteLink, revokeInviteLink, errorText } from './adminApi';
import { NOTE_MAX_LENGTH, STATUS_LABEL, STATUS_CLASS, formatDateTime, formatRemaining, validateLinkForm } from './inviteLinks';

const LABEL = 'block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

/** Create, copy (once) and revoke invite links. Limits and defaults come from the server. */
export default function InviteLinksPanel() {
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [defaults, setDefaults] = useState<InviteLinkDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [ttlHours, setTtlHours] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInviteLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (resetForm: boolean) => {
    setLoading(true);
    try {
      const r = await listInviteLinks();
      setLinks(r.links);
      setDefaults(r.defaults);
      if (resetForm) {
        setTtlHours(String(r.defaults.ttlHours));
        setMaxUses(String(r.defaults.maxUses));
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!defaults) return;
    setError(null);
    const v = validateLinkForm({ ttlHours, maxUses, note }, defaults);
    if (!v.ok) return setError(v.error);
    setBusy(true);
    try {
      setCreated(await createInviteLink(v.value));
      setCopied(false);
      setNote('');
      await load(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
    } catch {
      urlRef.current?.select();
      if (!document.execCommand('copy')) return setError('Copia non riuscita: seleziona il link e copialo a mano.');
    }
    setCopied(true);
  }

  async function revoke(id: string) {
    setError(null);
    setBusy(true);
    try {
      await revokeInviteLink(id);
      setRevoking(null);
      await load(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !defaults) return <p className="py-6 text-center text-sm text-slate-500">Caricamento…</p>;

  return (
    <div>
      {defaults && (
        <form onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={LABEL} htmlFor="il-ttl">Validità (ore)</label>
              <input id="il-ttl" type="number" inputMode="numeric" min={1} max={defaults.maxTtlHours} value={ttlHours}
                onChange={(e) => setTtlHours(e.target.value)} className="input" />
              <p className="mt-1 text-xs text-slate-600">Massimo {defaults.maxTtlHours}</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="il-uses">Utilizzi massimi</label>
              <input id="il-uses" type="number" inputMode="numeric" min={1} max={defaults.maxMaxUses} value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)} className="input" />
              <p className="mt-1 text-xs text-slate-600">Massimo {defaults.maxMaxUses}</p>
            </div>
          </div>
          <label className={LABEL} htmlFor="il-note">Nota (facoltativa)</label>
          <input id="il-note" value={note} maxLength={NOTE_MAX_LENGTH} onChange={(e) => setNote(e.target.value)}
            placeholder="es. Corso di giugno" className="input mb-3" />
          <button type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
            <Link2 className="w-4 h-4" /> {busy ? 'Attendi…' : 'Crea link'}
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

      {created && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="flex items-start gap-2 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Copia il link adesso: <b>non potrà essere mostrato di nuovo</b>. Chi lo apre può registrarsi
              (valido fino al {formatDateTime(created.expiresAt)}, {created.maxUses} {created.maxUses === 1 ? 'utilizzo' : 'utilizzi'}).
              Il nuovo utente non avrà accesso ad alcun dataset finché non glielo assegni.
            </span>
          </p>
          <div className="mt-2 flex gap-2">
            <input ref={urlRef} readOnly value={created.url} onFocus={(e) => e.currentTarget.select()}
              className="input font-mono text-xs" aria-label="Link di invito" />
            <button type="button" onClick={() => void copy()} className="btn-secondary shrink-0 flex items-center gap-2 px-3">
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copiato' : 'Copia'}
            </button>
          </div>
        </div>
      )}

      <p className={`${LABEL} mt-5`}>Link esistenti</p>
      <div className="rounded-lg border border-slate-700/60 divide-y divide-slate-700/30">
        {links.length === 0 ? (
          <p className="p-4 text-center text-sm text-slate-500">Nessun link.</p>
        ) : links.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="truncate text-slate-200">{l.note || <span className="text-slate-500">(senza nota)</span>}</span>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${STATUS_CLASS[l.status]}`}>{STATUS_LABEL[l.status]}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 [overflow-wrap:anywhere]">
                {l.createdBy} · creato {formatDateTime(l.createdAt)} · scade {formatDateTime(l.expiresAt)}
                {l.status === 'active' && ` (${formatRemaining(l.expiresAt, Date.now())})`} · usi {l.uses}/{l.maxUses}
              </p>
            </div>
            {l.status === 'active' && (revoking === l.id ? (
              <div className="shrink-0 flex items-center gap-1.5 text-xs">
                <span className="text-slate-400">Revocare?</span>
                <button type="button" disabled={busy} onClick={() => void revoke(l.id)}
                  className="rounded-lg bg-rose-500/20 px-2.5 py-1 text-rose-300 hover:bg-rose-500/30">Sì</button>
                <button type="button" onClick={() => setRevoking(null)} className="btn-secondary px-2.5 py-1 text-xs">No</button>
              </div>
            ) : (
              <button type="button" onClick={() => setRevoking(l.id)} className="btn-secondary shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm">
                <Ban className="w-3.5 h-3.5" /> Revoca
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Il link crea l’account direttamente, senza e-mail né verifica dell’indirizzo. Dopo la registrazione assegna i gruppi dal pulsante «Gestisci».
      </p>
    </div>
  );
}
