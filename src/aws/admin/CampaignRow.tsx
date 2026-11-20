import { useState } from 'react';
import { Copy, Check, Pencil, Trash2, RotateCcw } from 'lucide-react';
import type { Campaign, CampaignDefaults, CampaignPatch } from './adminApi';
import {
  STATUS_LABEL, STATUS_CLASS, formatDateTime, formatRemaining, copyText, linkForHost, toLocalInput,
  editRawFrom, validateCampaignEdit, reactivationPatch, MS_PER_HOUR,
} from './inviteLinks';

const LABEL = 'block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

interface Props {
  campaign: Campaign;
  /** Host the "Copia link" button copies the link for. */
  host: string;
  defaults: CampaignDefaults;
  busy: boolean;
  onPatch: (id: string, patch: CampaignPatch) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onError: (message: string) => void;
}

/** One campaign: status, always-available "Copia link", expandable edit form, reactivation and delete. */
export default function CampaignRow({ campaign: c, host, defaults, busy, onPatch, onDelete, onError }: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [raw, setRaw] = useState(() => editRawFrom(c));
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof typeof raw>(k: K, v: (typeof raw)[K]) => setRaw((r) => ({ ...r, [k]: v }));

  async function copy() {
    if (await copyText(linkForHost(c.url, host))) {
      setCopied(true);
      return;
    }
    onError('Copia non riuscita: apri la campagna e copia il link a mano.');
  }

  function openEdit() {
    setRaw(editRawFrom(c));
    setFormError(null);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = validateCampaignEdit(raw, c, defaults, Date.now());
    if (!v.ok) return setFormError(v.error);
    if (Object.keys(v.value).length === 0) return setEditing(false);
    if (await onPatch(c.id, v.value)) setEditing(false);
  }

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="truncate text-slate-200">{c.name}</span>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${STATUS_CLASS[c.status]}`}>{STATUS_LABEL[c.status]}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 [overflow-wrap:anywhere]">
            {c.createdBy} · creata {formatDateTime(c.createdAt)} · scade {formatDateTime(c.expiresAt)}
            {c.status === 'active' && ` (${formatRemaining(c.expiresAt, Date.now())})`} · usi {c.uses}/{c.maxUses}
          </p>
          {c.internalNote && <p className="mt-0.5 text-xs text-slate-400 [overflow-wrap:anywhere]">Nota interna: {c.internalNote}</p>}
        </div>
        <div className="shrink-0 flex flex-wrap items-center justify-end gap-1.5">
          <button type="button" onClick={() => void copy()} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiato' : 'Copia link'}
          </button>
          {c.status !== 'active' && (
            <button type="button" disabled={busy} onClick={() => void onPatch(c.id, reactivationPatch(c, defaults, Date.now()))}
              className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm" title="Riattiva con una nuova scadenza e/o più utilizzi">
              <RotateCcw className="w-3.5 h-3.5" /> Riattiva
            </button>
          )}
          <button type="button" onClick={() => (editing ? setEditing(false) : openEdit())} aria-expanded={editing}
            className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm">
            <Pencil className="w-3.5 h-3.5" /> Modifica
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400">Eliminare?</span>
              <button type="button" disabled={busy} onClick={() => void onDelete(c.id).then((ok) => ok || setConfirmDelete(false))}
                className="rounded-lg bg-rose-500/20 px-2.5 py-1 text-rose-300 hover:bg-rose-500/30">Sì</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn-secondary px-2.5 py-1 text-xs">No</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="btn-secondary px-2.5 py-1.5" aria-label="Elimina campagna" title="Elimina">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {confirmDelete && (
        <p className="mt-1.5 text-xs text-slate-500">Il link smette di funzionare; gli utenti già registrati mantengono la loro origine.</p>
      )}

      {editing && (
        <form onSubmit={(e) => void save(e)} className="mt-3 rounded-lg border border-slate-700/60 bg-slate-800/30 p-3">
          <label className={LABEL} htmlFor={`ce-name-${c.id}`}>Nome</label>
          <input id={`ce-name-${c.id}`} value={raw.name} maxLength={defaults.nameMaxLength}
            onChange={(e) => set('name', e.target.value)} className="input mb-3" />

          <label className={LABEL} htmlFor={`ce-pub-${c.id}`}>Nota pubblica: la vede chi apre il link</label>
          <textarea id={`ce-pub-${c.id}`} value={raw.publicNote} maxLength={defaults.publicNoteMaxLength} rows={3}
            onChange={(e) => set('publicNote', e.target.value)} className="input mb-3" />

          <label className={LABEL} htmlFor={`ce-int-${c.id}`}>Nota interna: solo admin</label>
          <input id={`ce-int-${c.id}`} value={raw.internalNote} maxLength={defaults.internalNoteMaxLength}
            onChange={(e) => set('internalNote', e.target.value)} className="input mb-3" />

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={LABEL} htmlFor={`ce-uses-${c.id}`}>Utilizzi massimi</label>
              <input id={`ce-uses-${c.id}`} type="number" inputMode="numeric" min={Math.max(c.uses, 1)} max={defaults.maxMaxUses}
                value={raw.maxUses} onChange={(e) => set('maxUses', e.target.value)} className="input" />
              <p className="mt-1 text-xs text-slate-600">Già usati {c.uses}: non si può scendere sotto. Massimo {defaults.maxMaxUses}.</p>
            </div>
            <div>
              <label className={LABEL} htmlFor={`ce-exp-${c.id}`}>Scadenza</label>
              <input id={`ce-exp-${c.id}`} type="datetime-local" value={raw.expires}
                onChange={(e) => set('expires', e.target.value)} className="input" />
              <button type="button" onClick={() => set('expires', toLocalInput(Date.now() + defaults.ttlHours * MS_PER_HOUR))}
                className="mt-1 text-xs text-amber-400 hover:underline">
                +{defaults.ttlHours} ore da ora
              </button>
              <p className="text-xs text-slate-600">Al massimo {defaults.maxTtlHours} ore da ora.</p>
            </div>
          </div>

          <label className="mb-3 flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" role="switch" checked={raw.enabled} onChange={(e) => set('enabled', e.target.checked)} className="accent-amber-500" />
            Campagna attiva (se disattivata il link non permette registrazioni)
          </label>

          {formError && <p className="mb-2 text-sm text-rose-400">{formError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn-secondary flex-1">Annulla</button>
            <button type="submit" disabled={busy} className="btn-primary flex-1">{busy ? 'Attendi…' : 'Salva'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
