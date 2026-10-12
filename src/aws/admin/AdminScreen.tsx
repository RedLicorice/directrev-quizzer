import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, UserPlus, Users, ScrollText, Search } from 'lucide-react';
import type { AdminUser, AdminOverview, AuditEntry } from './adminApi';
import { getOverview, listUsers, getAudit, errorText } from './adminApi';
import InviteModal from './InviteModal';
import UserDetailModal from './UserDetailModal';

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Attivo',
  FORCE_CHANGE_PASSWORD: 'Invitato',
  RESET_REQUIRED: 'Reset password',
  UNCONFIRMED: 'Non confermato',
};

function StatusBadge({ user }: { user: AdminUser }) {
  const cls = !user.enabled
    ? 'bg-slate-700/50 text-slate-400'
    : user.status === 'CONFIRMED'
      ? 'bg-emerald-500/15 text-emerald-400'
      : 'bg-amber-500/15 text-amber-400';
  return (
    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${cls}`}>
      {user.enabled ? (STATUS_LABEL[user.status] ?? user.status) : 'Disabilitato'}
    </span>
  );
}

/** Admin panel (AWS build, M7): user management + audit log. Reachable only for session.adm. */
export default function AdminScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const [auditDays, setAuditDays] = useState(30);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, u] = await Promise.all([getOverview(), listUsers()]);
      setOverview(o);
      setUsers(u.users);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async (days: number) => {
    setAuditLoading(true);
    setError(null);
    try {
      setAudit((await getAudit(days)).entries);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'audit') void loadAudit(auditDays); }, [tab, auditDays, loadAudit]);

  const datasets = overview?.datasets ?? [];
  const q = filter.trim().toLowerCase();
  const shown = q
    ? users.filter((u) => u.email.toLowerCase().includes(q) || u.groups.join(' ').includes(q))
    : users;
  const detail = detailKey ? (users.find((u) => u.key === detailKey) ?? null) : null;

  return (
    <div className="min-h-screen flex flex-col animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 z-10 glass border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-2" title="Indietro"><ArrowLeft className="w-5 h-5" /></button>
          <h1 className="text-base font-semibold">Amministrazione</h1>
          <div className="flex-1" />
          <button onClick={() => void (tab === 'audit' ? loadAudit(auditDays) : load())} className="btn-ghost p-2" title="Aggiorna">
            <RefreshCw className={`w-4 h-4 ${loading || auditLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
          )}

          {/* Overview */}
          {overview && (
            <div className="grid grid-cols-4 gap-3">
              {([
                ['Utenti', overview.users.total, 'text-slate-100'],
                ['Attivi', overview.users.confirmed, 'text-emerald-400'],
                ['Invitati', overview.users.pending, 'text-amber-400'],
                ['Disabilitati', overview.users.disabled, 'text-slate-400'],
              ] as const).map(([label, value, color]) => (
                <div key={label} className="card p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setTab('users')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${tab === 'users' ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              <Users className="w-4 h-4" /> Utenti
            </button>
            <button
              onClick={() => setTab('audit')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${tab === 'audit' ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              <ScrollText className="w-4 h-4" /> Audit
            </button>
          </div>

          {tab === 'users' && (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Cerca per e-mail o gruppo…"
                    className="input pl-9"
                  />
                </div>
                <button onClick={() => setInviteOpen(true)} className="btn-primary flex items-center gap-2 px-4 shrink-0">
                  <UserPlus className="w-4 h-4" /> Invita
                </button>
              </div>

              <div className="card overflow-hidden divide-y divide-slate-700/30">
                {loading && users.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">Caricamento…</div>
                ) : shown.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    {users.length === 0 ? 'Nessun utente.' : 'Nessun utente corrisponde alla ricerca.'}
                  </div>
                ) : (
                  shown.map((u) => (
                    <div key={u.key} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm text-slate-200">{u.email}</span>
                          <StatusBadge user={u} />
                        </div>
                        {u.groups.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {u.groups.map((g) => (
                              <span key={g} className="rounded bg-slate-700/50 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">{g}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button onClick={() => setDetailKey(u.key)} className="btn-secondary shrink-0 px-3 py-1.5 text-sm">
                        Gestisci
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {tab === 'audit' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Ultimi</span>
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setAuditDays(d)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                      ${auditDays === d ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                  >
                    {d} giorni
                  </button>
                ))}
              </div>
              <div className="card overflow-hidden divide-y divide-slate-700/30">
                {auditLoading ? (
                  <div className="p-8 text-center text-slate-500 text-sm">Caricamento…</div>
                ) : audit.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">Nessuna azione registrata.</div>
                ) : (
                  audit.map((e, i) => (
                    <div key={`${e.at}-${i}`} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                      <span className="shrink-0 font-mono text-xs text-slate-500 tabular-nums">
                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(e.at))}
                      </span>
                      <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-amber-300">{e.action}</span>
                      <span className="min-w-0 flex-1 text-slate-400 [overflow-wrap:anywhere]">
                        <span className="text-slate-300">{e.actor}</span>
                        {e.target && <> → <span className="text-slate-300">{e.target}</span></>}
                        {e.groups && e.groups.length > 0 && <span className="text-slate-500"> [{[...e.groups].sort().join(', ')}]</span>}
                        {e.detail && <span className="text-slate-600"> {e.detail}</span>}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <p className="text-xs text-slate-600">
                Le azioni sono registrate su CloudWatch Logs (retention 90 giorni).
              </p>
            </>
          )}
        </div>
      </div>

      {inviteOpen && (
        <InviteModal
          datasets={datasets}
          onClose={() => setInviteOpen(false)}
          onDone={() => { setInviteOpen(false); void load(); }}
        />
      )}

      {detail && (
        <UserDetailModal
          user={detail}
          datasets={datasets}
          onClose={() => setDetailKey(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
