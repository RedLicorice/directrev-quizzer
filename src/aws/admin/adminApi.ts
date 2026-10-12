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
}

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
  constructor(readonly status: number, readonly code: string) {
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
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === 'string') code = body.error;
    } catch {
      /* not JSON */
    }
    throw new AdminApiError(res.status, code);
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
      case 'not_found': return 'Utente non trovato.';
      default: return `Errore ${e.status} (${e.code}).`;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
