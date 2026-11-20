// Typed client for /api/admin/* (AWS build, admins only).
// Every call goes through apiFetch, which sends the session cookie, adds the
// `x-amz-content-sha256` header OAC requires on POST/PUT and refreshes once on 401.
import { apiFetch } from '../api';

export interface AdminUser {
  key: string; // base64url(username): used in the URL path
  email: string;
  sub?: string;
  status: string; // CONFIRMED | FORCE_CHANGE_PASSWORD | RESET_REQUIRED | ...
  enabled: boolean;
  groups: string[];
  /** How the user got their account; absent on old servers (treated as invited). */
  origin?: UserOrigin;
}

export type UserOrigin = { kind: 'invited' } | { kind: 'campaign'; campaignId: string; name: string };

export interface AdminOverview {
  datasets: string[];
  users: { total: number; confirmed: number; pending: number; disabled: number };
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  target?: string;
  groups?: string[];
  detail?: string;
}

export class AdminApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly reason?: string) {
    super(code);
    this.name = 'AdminApiError';
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-qz-csrf', '1');
  const res = await apiFetch(url, { ...init, headers });
  if (!res.ok) {
    let code = String(res.status);
    let reason: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown; reason?: unknown };
      if (body && typeof body.error === 'string') code = body.error;
      if (body && typeof body.reason === 'string') reason = body.reason;
    } catch {
      /* not JSON */
    }
    throw new AdminApiError(res.status, code, reason);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const mutate = <T>(url: string, method: string, body?: unknown) =>
  request<T>(url, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });

export const getOverview = () => request<AdminOverview>('/api/admin/overview');

export const listUsers = (filter = '') =>
  request<{ users: AdminUser[] }>(`/api/admin/users${filter ? `?filter=${encodeURIComponent(filter)}` : ''}`);

export const getAudit = (days: number) => request<{ days: number; entries: AuditEntry[] }>(`/api/admin/audit?days=${days}`);

export const inviteUser = (email: string, groups: string[], confirmMcd: boolean) =>
  mutate<{ email: string }>('/api/admin/users', 'POST', { email, groups, confirmMcd });

export const setUserGroups = (key: string, groups: string[], confirmMcd: boolean) =>
  mutate<{ groups: string[] }>(`/api/admin/users/${key}/groups`, 'PUT', { groups, confirmMcd });

export const resendInvite = (key: string) => mutate(`/api/admin/users/${key}/resend`, 'POST');
export const disableUser = (key: string) => mutate(`/api/admin/users/${key}/disable`, 'POST');
export const enableUser = (key: string) => mutate(`/api/admin/users/${key}/enable`, 'POST');
export const signOutUser = (key: string) => mutate(`/api/admin/users/${key}/signout`, 'POST');
export const resetUserPassword = (key: string) => mutate(`/api/admin/users/${key}/reset`, 'POST');
export const deleteUser = (key: string) => mutate(`/api/admin/users/${key}`, 'DELETE');

// ── campaigns (reusable registration links; endpoint kept as /invite-links) ────

export type CampaignStatus = 'active' | 'disabled' | 'expired' | 'exhausted';

export interface Campaign {
  id: string;
  url: string; // not a secret: always available
  name: string;
  publicNote?: string; // shown on the public join page
  internalNote?: string; // admins only
  createdBy: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  expiresAt: number; // epoch ms
  maxUses: number;
  uses: number;
  enabled: boolean;
  status: CampaignStatus;
}

/** Server-provided form defaults and limits (never hard-coded in the UI). */
export interface CampaignDefaults {
  ttlHours: number;
  maxTtlHours: number;
  maxUses: number;
  maxMaxUses: number;
  nameMaxLength: number;
  publicNoteMaxLength: number;
  internalNoteMaxLength: number;
}

export interface CampaignCreate {
  name: string;
  ttlHours: number;
  maxUses: number;
  publicNote?: string;
  internalNote?: string;
}

/** Any subset; an empty string for a note removes it; expiresAt is an absolute epoch ms. */
export interface CampaignPatch {
  name?: string;
  publicNote?: string;
  internalNote?: string;
  maxUses?: number;
  enabled?: boolean;
  expiresAt?: number;
}

export const listCampaigns = () =>
  request<{ links: Campaign[]; defaults: CampaignDefaults }>('/api/admin/invite-links');

export const createCampaign = (body: CampaignCreate) =>
  mutate<Campaign>('/api/admin/invite-links', 'POST', body);

export const updateCampaign = (id: string, patch: CampaignPatch) =>
  mutate<Campaign>(`/api/admin/invite-links/${id}`, 'PATCH', patch);

export const deleteCampaign = (id: string) =>
  mutate<{ id: string; deleted: true }>(`/api/admin/invite-links/${id}`, 'DELETE');

// ── dataset editing (admin, M7/P1) ────────────────────────────────────────────

export interface DatasetQuestionFile {
  sha: string;
  question: import('../../types').Question;
}

/** Latest repo copy of a question (the active dataset may be served from S3). */
export const getDatasetQuestion = (datasetId: string, qid: number) =>
  request<DatasetQuestionFile>(`/api/admin/datasets/${datasetId}/questions/${qid}`);

/** A new image sent with a save; the question references it as `upload:<token>`. */
export interface ImageUpload { token: string; data: string /* base64 */ }

export interface SavedQuestion {
  sha: string;
  commit: string;
  reformatted?: boolean;
  /** The question as committed (image paths are the ones the server assigned). */
  question: import('../../types').Question;
  /** upload token -> repo path the server gave the new image. */
  uploads: Record<string, string>;
}

/** Commits one question (and its new/removed images) to the dataset repo; the publish workflow updates S3. */
export const saveDatasetQuestion = (
  datasetId: string,
  qid: number,
  baseSha: string,
  question: import('../../types').Question,
  uploads: ImageUpload[] = [],
) =>
  mutate<SavedQuestion>(`/api/admin/datasets/${datasetId}/questions/${qid}`, 'PUT', {
    baseSha,
    question,
    ...(uploads.length ? { uploads } : {}),
  });

// Human-readable message for an AdminApiError code.
export function errorText(e: unknown): string {
  if (e instanceof AdminApiError) {
    switch (e.code) {
      case 'forbidden': return 'Non hai i permessi di amministratore.';
      case 'unauthenticated': return 'Sessione scaduta: ricarica la pagina.';
      case 'self_lockout': return 'Non puoi disabilitare, eliminare o togliere il gruppo admin a te stesso.';
      case 'exists': return 'Esiste già un utente con questa e-mail.';
      case 'bad_email': return 'E-mail non valida.';
      case 'bad_group': return 'Gruppo non valido.';
      case 'mcd_confirmation_required': return 'Conferma esplicitamente l’accesso a mule-mcd-01.';
      case 'rate_limited': return 'Troppe operazioni: riprova più tardi.';
      case 'not_found': return 'Elemento non trovato.';
      case 'invite_links_disabled': return 'Le campagne non sono abilitate su questo ambiente.';
      case 'bad_request':
        if (e.reason === 'max_uses_below_uses') return 'Gli utilizzi massimi non possono essere inferiori agli utilizzi già fatti.';
        if (e.reason === 'expires_at') return 'La scadenza deve essere futura e non oltre il limite massimo di validità.';
        return e.reason ? `Richiesta non valida (${e.reason}).` : 'Richiesta non valida: controlla i valori inseriti.';
      case 'dataset_not_editable': return 'Questo dataset non è modificabile da qui (serve un repo GitHub configurato).';
      case 'conflict': return 'Il dataset è cambiato nel frattempo: ricarica la domanda e riapplica le modifiche.';
      case 'too_large': return 'La domanda è troppo grande.';
      case 'invalid_question':
        if (e.reason === 'image_too_large') return 'Immagini troppo grandi: massimo 2 MB ciascuna e circa 3,5 MB in totale per salvataggio.';
        if (e.reason === 'image_invalid') return 'Immagine non valida: sono accettati solo PNG, JPEG, GIF e WebP.';
        if (e.reason === 'uploads') return 'Caricamento immagini non valido (troppe immagini in un solo salvataggio?).';
        return 'La domanda non è valida: controlla testo, opzioni, risposta corretta e selectCount.';
      case 'github_error': return 'GitHub non ha accettato la modifica (token mancante/scaduto o permessi insufficienti).';
      default: return `Errore ${e.status} (${e.code}).`;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
