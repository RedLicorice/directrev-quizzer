import { useCallback, useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import type { Campaign, CampaignDefaults, CampaignPatch } from './adminApi';
import { listCampaigns, createCampaign, updateCampaign, deleteCampaign, errorText } from './adminApi';
import { validateCampaignForm } from './inviteLinks';
import CampaignRow from './CampaignRow';

const LABEL = 'block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

/** Create, copy, edit, reactivate and delete campaigns. Limits and defaults come from the server. */
export default function InviteLinksPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [defaults, setDefaults] = useState<CampaignDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [ttlHours, setTtlHours] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (resetForm: boolean) => {
    setLoading(true);
    try {
      const r = await listCampaigns();
      setCampaigns(r.links);
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

  /** Runs one mutation then reloads the list; resolves true on success. */
  async function mutate(fn: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load(false);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!defaults) return;
    setError(null);
    const v = validateCampaignForm({ name, ttlHours, maxUses, publicNote, internalNote }, defaults);
    if (!v.ok) return setError(v.error);
    if (await mutate(() => createCampaign(v.value))) {
      setName('');
      setPublicNote('');
      setInternalNote('');
    }
  }

  const patch = (id: string, p: CampaignPatch) => mutate(() => updateCampaign(id, p));
  const remove = (id: string) => mutate(() => deleteCampaign(id));

  if (loading && !defaults) return <p className="py-6 text-center text-sm text-slate-500">Caricamento…</p>;

  return (
    <div>
      {defaults && (
        <form onSubmit={submit}>
          <label className={LABEL} htmlFor="il-name">Nome</label>
          <input id="il-name" value={name} maxLength={defaults.nameMaxLength} onChange={(e) => setName(e.target.value)}
            placeholder="es. Corso di giugno" className="input mb-3" />
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
          <label className={LABEL} htmlFor="il-pub">Nota pubblica: la vede chi apre il link</label>
          <textarea id="il-pub" value={publicNote} maxLength={defaults.publicNoteMaxLength} rows={3}
            onChange={(e) => setPublicNote(e.target.value)} className="input mb-3" />
          <label className={LABEL} htmlFor="il-int">Nota interna: solo admin</label>
          <input id="il-int" value={internalNote} maxLength={defaults.internalNoteMaxLength}
            onChange={(e) => setInternalNote(e.target.value)} className="input mb-3" />
          <button type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
            <Link2 className="w-4 h-4" /> {busy ? 'Attendi…' : 'Crea campagna'}
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

      <p className={`${LABEL} mt-5`}>Campagne</p>
      <div className="rounded-lg border border-slate-700/60 divide-y divide-slate-700/30">
        {campaigns.length === 0 || !defaults ? (
          <p className="p-4 text-center text-sm text-slate-500">Nessuna campagna.</p>
        ) : campaigns.map((c) => (
          <CampaignRow key={c.id} campaign={c} defaults={defaults} busy={busy}
            onPatch={patch} onDelete={remove} onError={setError} />
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Il link crea l’account direttamente, senza e-mail né verifica dell’indirizzo, e si può copiare in qualsiasi momento.
        Dopo la registrazione assegna i gruppi dal pulsante «Gestisci».
      </p>
    </div>
  );
}
