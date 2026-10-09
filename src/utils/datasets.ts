import type { Question, SourceConfig, DatasetEntry, DatasetIndex } from '../types';
import { getStorageUser, userScoped } from './storage';
import { apiFetch, DatasetNotEnabledError } from '../aws/api';
import { allowedDatasetIds, currentSession } from '../aws/auth/session';

const SOURCES_KEY = 'quizzer_sources';
const ACTIVE_KEY = 'quizzer_active_dataset';
export const BUNDLED_SOURCE_ID = 'bundled';
/** The built-in same-origin source of the AWS build (never stored, never removable). */
export const HOSTED_SOURCE_ID = 'hosted';

export interface ActiveRef { sourceId: string; datasetId: string }

/** AWS build: source list and active selection are per user too (`<key>:u:<sub>`). */
function perUserKey(key: string): string {
  if (import.meta.env.VITE_DEPLOY === 'aws') return `${key}:u:${getStorageUser() ?? '?'}`;
  return key;
}

// ── persisted source list / active selection ───────────────────────────────

export function loadSources(): SourceConfig[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(perUserKey(SOURCES_KEY)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const list = parsed as SourceConfig[];
    return import.meta.env.VITE_DEPLOY === 'aws' ? list.filter((s) => s.kind !== 'hosted') : list;
  } catch { return []; }
}

export function saveSources(sources: SourceConfig[]) {
  const list = import.meta.env.VITE_DEPLOY === 'aws' ? sources.filter((s) => s.kind !== 'hosted') : sources;
  try { localStorage.setItem(perUserKey(SOURCES_KEY), JSON.stringify(list)); } catch { /* ignore */ }
}

export function loadActive(): ActiveRef | null {
  try {
    const v = JSON.parse(localStorage.getItem(perUserKey(ACTIVE_KEY)) ?? 'null');
    return v && v.sourceId && v.datasetId ? (v as ActiveRef) : null;
  } catch { return null; }
}

export function saveActive(ref: ActiveRef) {
  try { localStorage.setItem(perUserKey(ACTIVE_KEY), JSON.stringify(ref)); } catch { /* ignore */ }
}

/**
 * Key under which a dataset's progress is stored.
 * Pages build: `aws-dva-c02` for the bundled dataset, `<sourceId>:<datasetId>` otherwise (unchanged).
 * AWS build: `u:<sub>:hosted:<datasetId>` for the hosted source, `u:<sub>:<sourceId>:<datasetId>` otherwise.
 */
export function datasetKey(sourceId: string, datasetId: string, bundledKey: string): string {
  if (import.meta.env.VITE_DEPLOY === 'aws') return userScoped(`${sourceId}:${datasetId}`);
  return sourceId === BUNDLED_SOURCE_ID ? bundledKey : `${sourceId}:${datasetId}`;
}

/** The built-in hosted source (AWS build): same origin, `${BASE_URL}data/`, cookie-authenticated. */
export function hostedSource(): SourceConfig {
  return { id: HOSTED_SOURCE_ID, name: 'Quizzer', kind: 'hosted' };
}

export function newSourceId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'source';
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── URL building ───────────────────────────────────────────────────────────

function joinPath(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p && p !== '.').join('/').replace(/\/+/g, '/').replace(/^\//, '');
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function rawUrl(src: SourceConfig, path: string): string {
  if (import.meta.env.VITE_DEPLOY === 'aws' && src.kind === 'hosted') return `${import.meta.env.BASE_URL}data/${encodeURI(path)}`;
  if (src.kind === 'url') return `${(src.url ?? '').replace(/\/+$/, '')}/${path}`;
  return `https://raw.githubusercontent.com/${src.repo}/${src.ref || 'main'}/${encodeURI(path)}`;
}

function apiUrl(src: SourceConfig, path: string): string {
  return `https://api.github.com/repos/${src.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(src.ref || 'main')}`;
}

/** Path of a file inside the source (github sources may live in a sub-directory). */
function sourcePath(src: SourceConfig, rel: string): string {
  return src.kind === 'github' ? joinPath(src.path, rel) : rel;
}

const PRIVATE_PREFIX = 'ghapi:';

/**
 * URL usable in <img src>. Private repos return a sentinel resolved by DatasetImage with the token.
 * Hosted images are plain same-origin URLs: the session cookie authenticates them (no blob fetch).
 */
export function imageSrc(src: SourceConfig, rel: string): string {
  const path = sourcePath(src, rel);
  if (src.kind === 'github' && src.token) return `${PRIVATE_PREFIX}${src.id}|${path}`;
  return rawUrl(src, path);
}

// ── fetching ───────────────────────────────────────────────────────────────

async function fetchResource(src: SourceConfig, path: string): Promise<Response> {
  if (import.meta.env.VITE_DEPLOY === 'aws' && src.kind === 'hosted') {
    const res = await apiFetch(rawUrl(src, path), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
    return res;
  }
  const useApi = src.kind === 'github' && !!src.token;
  const res = await fetch(useApi ? apiUrl(src, path) : rawUrl(src, path), {
    headers: useApi
      ? { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${src.token}` }
      : undefined,
    cache: 'no-cache',
  });
  if (!res.ok) {
    const hint = res.status === 404 && src.kind === 'github' && !src.token ? ' (private repo? add a token)' : '';
    throw new Error(`${res.status} ${res.statusText} — ${path}${hint}`);
  }
  return res;
}

/** One dataset of the hosted source: its entry, or why it could not be listed. */
export interface HostedListing { id: string; entry?: DatasetEntry; error?: string }

/**
 * Hosted source (AWS build): there is no shared index. Each dataset id the session allows is
 * read from `data/<id>/index.json`; its entry's `file` is rewritten relative to `data/`.
 */
export async function loadHostedIndex(): Promise<HostedListing[]> {
  const src = hostedSource();
  const ids = allowedDatasetIds(currentSession());
  return Promise.all(ids.map(async (id): Promise<HostedListing> => {
    try {
      const res = await fetchResource(src, `${id}/index.json`);
      const idx = (await res.json()) as DatasetIndex;
      const e = idx?.datasets?.find((d) => d.id === id) ?? (idx?.datasets?.length === 1 ? idx.datasets[0] : undefined);
      if (!e || typeof e.file !== 'string') throw new Error(`${id}/index.json: dataset "${id}" missing`);
      return { id, entry: { ...e, id, file: joinPath(id, e.file) } };
    } catch (err) {
      return { id, error: err instanceof DatasetNotEnabledError ? err.message : err instanceof Error ? err.message : String(err) };
    }
  }));
}

export async function loadIndex(src: SourceConfig): Promise<DatasetEntry[]> {
  if (import.meta.env.VITE_DEPLOY === 'aws' && src.kind === 'hosted') {
    return (await loadHostedIndex()).flatMap((l) => (l.entry ? [l.entry] : []));
  }
  const res = await fetchResource(src, sourcePath(src, 'index.json'));
  const idx = (await res.json()) as DatasetIndex;
  if (!idx || !Array.isArray(idx.datasets)) throw new Error('index.json: missing "datasets" array');
  return idx.datasets;
}

const ABSOLUTE = /^(data:|https?:|blob:|\/\/)/i;

function resolveImage(src: SourceConfig, baseDir: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (ABSOLUTE.test(value) || value.startsWith(PRIVATE_PREFIX)) return value;
  return imageSrc(src, joinPath(baseDir, value));
}

export async function loadDataset(src: SourceConfig, entry: DatasetEntry): Promise<Question[]> {
  const res = await fetchResource(src, sourcePath(src, entry.file));
  const raw = (await res.json()) as Question[];
  if (!Array.isArray(raw) || raw.length === 0 || !raw[0].text) throw new Error(`${entry.file}: not a valid questions array`);
  const baseDir = dirOf(entry.file);
  return raw.map((q) => ({
    ...q,
    image: resolveImage(src, baseDir, q.image),
    explanationImage: resolveImage(src, baseDir, q.explanationImage),
    options: q.options.map((o) => (o.image ? { ...o, image: resolveImage(src, baseDir, o.image) } : o)),
  }));
}

// ── private images ─────────────────────────────────────────────────────────

const blobCache = new Map<string, Promise<string>>();

/**
 * Logout (AWS build): drop everything private kept in memory or caches — object URLs of
 * token-fetched images, Cache Storage entries other than the app-shell precache, sessionStorage.
 */
export async function clearPrivateCaches(): Promise<void> {
  for (const p of blobCache.values()) p.then((u) => URL.revokeObjectURL(u), () => {});
  blobCache.clear();
  try { sessionStorage.clear(); } catch { /* unavailable */ }
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith('workbox-precache')).map((n) => caches.delete(n)));
    }
  } catch { /* unavailable */ }
}

export function isPrivateImage(value: string): boolean { return value.startsWith(PRIVATE_PREFIX); }

/** Resolves a `ghapi:` sentinel to an object URL by fetching the file with the source's token. */
export function fetchPrivateImage(value: string): Promise<string> {
  let p = blobCache.get(value);
  if (!p) {
    const [sourceId, path] = value.slice(PRIVATE_PREFIX.length).split('|');
    const src = loadSources().find((s) => s.id === sourceId);
    p = src
      ? fetchResource(src, path).then((r) => r.blob()).then((b) => URL.createObjectURL(b))
      : Promise.reject(new Error(`Unknown source "${sourceId}"`));
    blobCache.set(value, p);
    p.catch(() => blobCache.delete(value));
  }
  return p;
}
