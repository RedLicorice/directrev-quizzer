import { useEffect, useState } from 'react';
import { X, Database, Plus, Trash2, RefreshCw, AlertTriangle, CheckCircle2, Lock, Globe } from 'lucide-react';
import type { DatasetEntry, SourceConfig } from '../types';
import { BUNDLED_SOURCE_ID, loadIndex, loadSources, saveSources, newSourceId } from '../utils/datasets';

export interface BundledInfo { id: string; title: string; questions: number }

interface Props {
  bundled: BundledInfo;
  active: { sourceId: string; datasetId: string };
  loading: boolean;
  error: string | null;
  onSelect: (source: SourceConfig | null, entry: DatasetEntry) => void;
  onClose: () => void;
}

type IndexState = { status: 'loading' } | { status: 'ok'; datasets: DatasetEntry[] } | { status: 'error'; message: string };

const EMPTY = { name: '', kind: 'github' as 'github' | 'url', repo: '', ref: 'main', path: '', token: '', url: '' };

export default function DatasetPickerModal({ bundled, active, loading, error, onSelect, onClose }: Props) {
  const [sources, setSources] = useState<SourceConfig[]>(() => loadSources());
  const [indexes, setIndexes] = useState<Record<string, IndexState>>({});
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);

  function refresh(src: SourceConfig) {
    setIndexes((m) => ({ ...m, [src.id]: { status: 'loading' } }));
    loadIndex(src).then(
      (datasets) => setIndexes((m) => ({ ...m, [src.id]: { status: 'ok', datasets } })),
      (e) => setIndexes((m) => ({ ...m, [src.id]: { status: 'error', message: e instanceof Error ? e.message : String(e) } })),
    );
  }

  useEffect(() => { sources.forEach(refresh); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function persist(next: SourceConfig[]) { setSources(next); saveSources(next); }

  const formValid = form.name.trim() && (form.kind === 'github' ? /^[\w.-]+\/[\w.-]+$/.test(form.repo.trim()) : /^https?:\/\//.test(form.url.trim()));

  function addSource() {
    if (!formValid) return;
    const src: SourceConfig = form.kind === 'github'
      ? { id: newSourceId(form.name), name: form.name.trim(), kind: 'github', repo: form.repo.trim(), ref: form.ref.trim() || 'main', path: form.path.trim().replace(/^\/|\/$/g, ''), token: form.token.trim() || undefined }
      : { id: newSourceId(form.name), name: form.name.trim(), kind: 'url', url: form.url.trim() };
    persist([...sources, src]);
    refresh(src);
    setForm(EMPTY); setAdding(false);
  }

  function removeSource(id: string) { persist(sources.filter((s) => s.id !== id)); }

  const isActive = (sourceId: string, datasetId: string) => active.sourceId === sourceId && active.datasetId === datasetId;
  const input = 'w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/60';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 animate-slide-up">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Database className="w-5 h-5 text-amber-400" /> Datasets</h2>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span className="break-words">{error}</span>
          </div>
        )}

        <section className="mb-5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Built in</h3>
          <DatasetRow title={bundled.title} meta={`${bundled.questions} questions · works offline`} active={isActive(BUNDLED_SOURCE_ID, bundled.id)} disabled={loading}
            onClick={() => onSelect(null, { id: bundled.id, title: bundled.title, file: '' })} />
        </section>

        {sources.map((src) => {
          const st = indexes[src.id];
          return (
            <section key={src.id} className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                {src.token ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Globe className="w-3.5 h-3.5 text-slate-500" />}
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">{src.name}</h3>
                <span className="text-xs text-slate-600 truncate">{src.kind === 'github' ? `${src.repo}@${src.ref}` : src.url}</span>
                <div className="flex-1" />
                <button onClick={() => refresh(src)} className="btn-ghost p-1" title="Reload index"><RefreshCw className="w-3.5 h-3.5" /></button>
                <button onClick={() => removeSource(src.id)} className="btn-ghost p-1 text-rose-400" title="Remove source"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              {(!st || st.status === 'loading') && <p className="text-sm text-slate-500">Loading…</p>}
              {st?.status === 'error' && <p className="text-sm text-rose-400 break-words">{st.message}</p>}
              {st?.status === 'ok' && (st.datasets.length === 0
                ? <p className="text-sm text-slate-500">No datasets in this source.</p>
                : <div className="space-y-2">{st.datasets.map((d) => (
                    <DatasetRow key={d.id} title={d.title}
                      meta={[d.questions != null && `${d.questions} questions`, d.images != null && `${d.images} images`].filter(Boolean).join(' · ')}
                      active={isActive(src.id, d.id)} disabled={loading} onClick={() => onSelect(src, d)} />
                  ))}</div>)}
            </section>
          );
        })}

        {adding ? (
          <section className="border-t border-slate-700/50 pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-300">Add a source</h3>
            <input className={input} placeholder="Name (e.g. My quiz data)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="flex gap-2">
              {(['github', 'url'] as const).map((k) => (
                <button key={k} onClick={() => setForm({ ...form, kind: k })}
                  className={`flex-1 text-sm py-1.5 rounded-lg border ${form.kind === k ? 'border-amber-500/60 text-amber-400 bg-amber-500/10' : 'border-slate-700 text-slate-400'}`}>
                  {k === 'github' ? 'GitHub repo' : 'Static URL'}
                </button>
              ))}
            </div>
            {form.kind === 'github' ? (<>
              <input className={input} placeholder="owner/repository" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
              <div className="flex gap-2">
                <input className={input} placeholder="branch / tag (main)" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} />
                <input className={input} placeholder="folder (optional)" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
              </div>
              <input className={input} type="password" autoComplete="off" placeholder="Token for private repos (optional)" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
              <p className="text-xs text-slate-500">Use a fine-grained, read-only token limited to this repository (Contents: read). It is stored only in this browser.</p>
            </>) : (
              <input className={input} placeholder="https://host/path/to/folder (contains index.json)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            )}
            <div className="flex gap-3">
              <button onClick={() => { setAdding(false); setForm(EMPTY); }} className="btn-secondary flex-1">Cancel</button>
              <button onClick={addSource} disabled={!formValid} className="btn-primary flex-1 disabled:opacity-40">Add</button>
            </div>
          </section>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            <Plus className="w-4 h-4" /> Add a source
          </button>
        )}
      </div>
    </div>
  );
}

function DatasetRow({ title, meta, active, disabled, onClick }: { title: string; meta: string; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full text-left px-4 py-3 rounded-xl border transition-colors disabled:opacity-50 ${active ? 'border-amber-500/60 bg-amber-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium text-slate-200">{title}</span>
        {active && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
      </div>
      {meta && <div className="text-xs text-slate-500 mt-0.5">{meta}</div>}
    </button>
  );
}
