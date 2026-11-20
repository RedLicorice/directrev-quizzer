// Pure helpers for the campaign UI (no React, no network): labels, formatting, form validation.
import type { Campaign, CampaignCreate, CampaignDefaults, CampaignPatch, CampaignStatus, UserOrigin } from './adminApi';

export const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  active: 'Attiva',
  disabled: 'Disattivata',
  expired: 'Scaduta',
  exhausted: 'Esaurita',
};

export const STATUS_CLASS: Record<CampaignStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  disabled: 'bg-rose-500/15 text-rose-400',
  expired: 'bg-slate-700/50 text-slate-400',
  exhausted: 'bg-amber-500/15 text-amber-400',
};

export const formatDateTime = (ms: number): string =>
  new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));

/** "tra 3 g 4 h" / "tra 5 h" / "tra meno di 1 h" / "scaduto". */
export function formatRemaining(expiresAt: number, now: number): string {
  const left = expiresAt - now;
  if (left <= 0) return 'scaduto';
  const hours = Math.floor(left / MS_PER_HOUR);
  if (hours < 1) return 'tra meno di 1 h';
  const days = Math.floor(hours / HOURS_PER_DAY);
  const rest = hours % HOURS_PER_DAY;
  if (days === 0) return `tra ${hours} h`;
  return rest === 0 ? `tra ${days} g` : `tra ${days} g ${rest} h`;
}

/** "Invitato" for users created by an admin (or without origin data), the campaign name otherwise. */
export const originLabel = (origin?: UserOrigin): string =>
  origin?.kind === 'campaign' ? origin.name : 'Invitato';

// ── <input type="datetime-local"> <-> epoch ms (local time, minute precision) ──

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** NaN when the string is empty or not a date. */
export const fromLocalInput = (s: string): number => (s ? new Date(s).getTime() : NaN);

// ── validation ──

type Check<T> = { ok: true; value: T } | { ok: false; error: string };
export type CampaignFormResult = Check<CampaignCreate>;
export type CampaignEditResult = Check<CampaignPatch>;

const isPositiveInt = (s: string): boolean => /^\d+$/.test(s.trim()) && Number(s) >= 1;

interface TextFields { name: string; publicNote: string; internalNote: string }

/** Trims and length-checks the three text fields against the server limits. */
function checkTexts(raw: TextFields, limits: CampaignDefaults): Check<TextFields> {
  const v = { name: raw.name.trim(), publicNote: raw.publicNote.trim(), internalNote: raw.internalNote.trim() };
  if (!v.name) return { ok: false, error: 'Il nome è obbligatorio.' };
  if (v.name.length > limits.nameMaxLength) {
    return { ok: false, error: `Il nome può avere al massimo ${limits.nameMaxLength} caratteri.` };
  }
  if (v.publicNote.length > limits.publicNoteMaxLength) {
    return { ok: false, error: `La nota pubblica può avere al massimo ${limits.publicNoteMaxLength} caratteri.` };
  }
  if (v.internalNote.length > limits.internalNoteMaxLength) {
    return { ok: false, error: `La nota interna può avere al massimo ${limits.internalNoteMaxLength} caratteri.` };
  }
  return { ok: true, value: v };
}

/** Validates the raw create-form strings against the server-provided limits. */
export function validateCampaignForm(
  raw: TextFields & { ttlHours: string; maxUses: string },
  limits: CampaignDefaults,
): CampaignFormResult {
  const texts = checkTexts(raw, limits);
  if (!texts.ok) return texts;
  if (!isPositiveInt(raw.ttlHours) || Number(raw.ttlHours) > limits.maxTtlHours) {
    return { ok: false, error: `La validità deve essere un numero intero di ore tra 1 e ${limits.maxTtlHours}.` };
  }
  if (!isPositiveInt(raw.maxUses) || Number(raw.maxUses) > limits.maxMaxUses) {
    return { ok: false, error: `Gli utilizzi devono essere un numero intero tra 1 e ${limits.maxMaxUses}.` };
  }
  const { name, publicNote, internalNote } = texts.value;
  return {
    ok: true,
    value: {
      name,
      ttlHours: Number(raw.ttlHours),
      maxUses: Number(raw.maxUses),
      ...(publicNote ? { publicNote } : {}),
      ...(internalNote ? { internalNote } : {}),
    },
  };
}

export interface CampaignEditRaw extends TextFields {
  maxUses: string;
  /** datetime-local value (see toLocalInput). */
  expires: string;
  enabled: boolean;
}

export const editRawFrom = (c: Campaign): CampaignEditRaw => ({
  name: c.name,
  publicNote: c.publicNote ?? '',
  internalNote: c.internalNote ?? '',
  maxUses: String(c.maxUses),
  expires: toLocalInput(c.expiresAt),
  enabled: c.enabled,
});

/**
 * Validates the edit form and returns only the changed fields.
 * Max uses may not go below the uses already made; a changed expiry must be in the future and within maxTtlHours.
 */
export function validateCampaignEdit(
  raw: CampaignEditRaw,
  current: Campaign,
  limits: CampaignDefaults,
  now: number,
): CampaignEditResult {
  const texts = checkTexts(raw, limits);
  if (!texts.ok) return texts;
  if (!isPositiveInt(raw.maxUses) || Number(raw.maxUses) > limits.maxMaxUses) {
    return { ok: false, error: `Gli utilizzi devono essere un numero intero tra 1 e ${limits.maxMaxUses}.` };
  }
  const maxUses = Number(raw.maxUses);
  if (maxUses < current.uses) {
    return { ok: false, error: `Gli utilizzi massimi non possono essere inferiori agli utilizzi già fatti (${current.uses}).` };
  }
  const patch: CampaignPatch = {};
  const { name, publicNote, internalNote } = texts.value;
  if (name !== current.name) patch.name = name;
  if (publicNote !== (current.publicNote ?? '')) patch.publicNote = publicNote;
  if (internalNote !== (current.internalNote ?? '')) patch.internalNote = internalNote;
  if (maxUses !== current.maxUses) patch.maxUses = maxUses;
  if (raw.enabled !== current.enabled) patch.enabled = raw.enabled;
  if (raw.expires !== toLocalInput(current.expiresAt)) {
    const expiresAt = fromLocalInput(raw.expires);
    if (Number.isNaN(expiresAt) || expiresAt <= now || expiresAt > now + limits.maxTtlHours * MS_PER_HOUR) {
      return { ok: false, error: `La scadenza deve essere futura e al massimo tra ${limits.maxTtlHours} ore da ora.` };
    }
    patch.expiresAt = expiresAt;
  }
  return { ok: true, value: patch };
}

/**
 * One-click "Riattiva": switches the campaign on and, only where needed, gives it a new default expiry
 * and room for `defaults.maxUses` more registrations (capped at the server maximum).
 */
export function reactivationPatch(c: Campaign, limits: CampaignDefaults, now: number): CampaignPatch {
  const patch: CampaignPatch = { enabled: true };
  if (c.expiresAt <= now) patch.expiresAt = now + limits.ttlHours * MS_PER_HOUR;
  if (c.uses >= c.maxUses) patch.maxUses = Math.min(c.uses + limits.maxUses, limits.maxMaxUses);
  return patch;
}

/** Users without any group cannot open a dataset yet (typically registered through a campaign). */
export const hasNoAccess = (groups: readonly string[]): boolean => groups.length === 0;

/** Clipboard write with a textarea fallback for contexts where the async API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } finally {
      ta.remove();
    }
  }
}
