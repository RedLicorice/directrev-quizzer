import type { Question, SourceConfig, DatasetEntry, DatasetIndex } from '../types';

const SOURCES_KEY = 'quizzer_sources';
const ACTIVE_KEY = 'quizzer_active_dataset';
export const BUNDLED_SOURCE_ID = 'bundled';

export interface ActiveRef { sourceId: string; datasetId: string }

// ── persisted source list / active selection ───────────────────────────────

export function loadSources(): SourceConfig[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SOURCES_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SourceConfig[]) : [];
  } catch { return []; }
}

export function saveSources(sources: SourceConfig[]) {
  try { localStorage.setItem(SOURCES_KEY, JSON.stringify(sources)); } catch { /* ignore */ }
}

export function loadActive(): ActiveRef | null {
  try {
    const v = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? 'null');
    return v && v.sourceId && v.datasetId ? (v as ActiveRef) : null;
  } catch { return null; }
}

export function saveActive(ref: ActiveRef) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(ref)); } catch { /* ignore */ }
}

/** Key under which a dataset's progress is stored. */
export function datasetKey(sourceId: string, datasetId: string, bundledKey: string): string {
  return sourceId === BUNDLED_SOURCE_ID ? bundledKey : `${sourceId}:${datasetId}`;
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

function rawUrl(src: SourceConfig, path: string): string {
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

/** URL usable in <img src>. Private repos return a sentinel resolved by DatasetImage with the token. */
function imageSrc(src: SourceConfig, rel: string): string {
  const path = sourcePath(src, rel);
  if (src.kind === 'github' && src.token) return `${PRIVATE_PREFIX}${src.id}|${path}`;
  return rawUrl(src, path);
}

// ── fetching ───────────────────────────────────────────────────────────────

async function fetchResource(src: SourceConfig, path: string): Promise<Response> {
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

export async function loadIndex(src: SourceConfig): Promise<DatasetEntry[]> {
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
