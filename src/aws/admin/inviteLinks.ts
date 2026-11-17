// Pure helpers for the invite-link UI (no React, no network): labels, formatting, form validation.
import type { InviteLinkDefaults, InviteLinkRequest, InviteLinkStatus } from './adminApi';

/** Mirrors the server limit on the free-text note (contract: <= 80 chars). */
export const NOTE_MAX_LENGTH = 80;

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

export const STATUS_LABEL: Record<InviteLinkStatus, string> = {
  active: 'Attivo',
  expired: 'Scaduto',
  exhausted: 'Esaurito',
  revoked: 'Revocato',
};

export const STATUS_CLASS: Record<InviteLinkStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  expired: 'bg-slate-700/50 text-slate-400',
  exhausted: 'bg-amber-500/15 text-amber-400',
  revoked: 'bg-rose-500/15 text-rose-400',
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

export type LinkFormResult = { ok: true; value: InviteLinkRequest } | { ok: false; error: string };

const isPositiveInt = (s: string): boolean => /^\d+$/.test(s.trim()) && Number(s) >= 1;

/** Validates the raw form strings against the server-provided limits. */
export function validateLinkForm(
  raw: { ttlHours: string; maxUses: string; note: string },
  limits: InviteLinkDefaults,
): LinkFormResult {
  if (!isPositiveInt(raw.ttlHours) || Number(raw.ttlHours) > limits.maxTtlHours) {
    return { ok: false, error: `La validità deve essere un numero intero di ore tra 1 e ${limits.maxTtlHours}.` };
  }
  if (!isPositiveInt(raw.maxUses) || Number(raw.maxUses) > limits.maxMaxUses) {
    return { ok: false, error: `Gli utilizzi devono essere un numero intero tra 1 e ${limits.maxMaxUses}.` };
  }
  const note = raw.note.trim();
  if (note.length > NOTE_MAX_LENGTH) {
    return { ok: false, error: `La nota può avere al massimo ${NOTE_MAX_LENGTH} caratteri.` };
  }
  return {
    ok: true,
    value: { ttlHours: Number(raw.ttlHours), maxUses: Number(raw.maxUses), ...(note ? { note } : {}) },
  };
}

/** Users without any group cannot open a dataset yet (typically registered through a link). */
export const hasNoAccess = (groups: readonly string[]): boolean => groups.length === 0;
