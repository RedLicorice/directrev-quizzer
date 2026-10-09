import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { json, stubBrowser } from './helpers';
import { rawUrl, imageSrc, datasetKey, hostedSource, loadHostedIndex, loadDataset, loadIndex, loadSources, saveSources, BUNDLED_SOURCE_ID } from '../src/utils/datasets';
import { setStorageUser, setActiveDataset, statsKey, notesKey, userScoped, BUNDLED_DATASET_KEY } from '../src/utils/storage';
import { setCurrentSession, _resetForTests } from '../src/aws/auth/session';
import type { Session, SourceConfig } from '../src/types';

const GH: SourceConfig = { id: 'gh-1', name: 'gh', kind: 'github', repo: 'o/r', ref: 'v1', path: 'sub' };
const GH_PRIV: SourceConfig = { ...GH, id: 'gh-2', token: 'tkn' };
const URL_SRC: SourceConfig = { id: 'u-1', name: 'u', kind: 'url', url: 'https://host/folder/' };
const SESSION: Session = { sub: 'sub-a', email: 'a@x', ds: ['aws-dva-c02', 'mule-mcd-01'], adm: false, exp: 4102444800 };

let b: ReturnType<typeof stubBrowser>;
beforeEach(() => { b = stubBrowser(); _resetForTests(); setStorageUser(null); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('URL building, three source kinds', () => {
  it('github (public → raw, private → ghapi sentinel) and url', () => {
    expect(rawUrl(GH, 'sub/index.json')).toBe('https://raw.githubusercontent.com/o/r/v1/sub/index.json');
    expect(imageSrc(GH, 'ds/images/a b.png')).toBe('https://raw.githubusercontent.com/o/r/v1/sub/ds/images/a%20b.png');
    expect(imageSrc(GH_PRIV, 'ds/images/a.png')).toBe('ghapi:gh-2|sub/ds/images/a.png');
    expect(rawUrl(URL_SRC, 'index.json')).toBe('https://host/folder/index.json');
  });
  it('hosted → same-origin ${BASE_URL}data/<path>, plain <img> URLs (aws build)', () => {
    vi.stubEnv('VITE_DEPLOY', 'aws');
    const h = hostedSource();
    expect(h).toEqual({ id: 'hosted', name: 'Quizzer', kind: 'hosted' });
    expect(rawUrl(h, 'mule-mcd-01/index.json')).toBe('/data/mule-mcd-01/index.json');
    expect(imageSrc(h, 'mule-mcd-01/images/q001_A.jpeg')).toBe('/data/mule-mcd-01/images/q001_A.jpeg');
  });
});

describe('progress keys', () => {
  it('Pages build: unchanged (bundled → aws-dva-c02, sources → <source>:<id>) and legacy migration kept', () => {
    expect(datasetKey(BUNDLED_SOURCE_ID, 'aws-dva-c02', BUNDLED_DATASET_KEY)).toBe('aws-dva-c02');
    expect(datasetKey('gh-1', 'x', BUNDLED_DATASET_KEY)).toBe('gh-1:x');
    expect(userScoped('imported-file')).toBe('imported-file');
    b.local.setItem('quizzer_stats', '{"1":{"correct":1,"wrong":0}}');
    setActiveDataset(BUNDLED_DATASET_KEY);
    expect(b.local.getItem('quizzer_stats:aws-dva-c02')).toBe('{"1":{"correct":1,"wrong":0}}');
    expect(b.local.getItem('quizzer_stats')).toBeNull();
  });
  it('AWS build: u:<sub>:hosted:<datasetId>, different users never share keys', () => {
    vi.stubEnv('VITE_DEPLOY', 'aws');
    setStorageUser('sub-a');
    expect(datasetKey('hosted', 'aws-dva-c02', BUNDLED_DATASET_KEY)).toBe('u:sub-a:hosted:aws-dva-c02');
    expect(datasetKey('gh-1', 'x', BUNDLED_DATASET_KEY)).toBe('u:sub-a:gh-1:x');
    setActiveDataset(datasetKey('hosted', 'aws-dva-c02', BUNDLED_DATASET_KEY));
    expect(statsKey()).toBe('quizzer_stats:u:sub-a:hosted:aws-dva-c02');
    expect(notesKey()).toBe('quizzer_notes:u:sub-a:hosted:aws-dva-c02');
    setStorageUser('sub-b');
    setActiveDataset(datasetKey('hosted', 'aws-dva-c02', BUNDLED_DATASET_KEY));
    expect(statsKey()).toBe('quizzer_stats:u:sub-b:hosted:aws-dva-c02');
  });
  it('AWS build: no legacy migration into a user bucket', () => {
    vi.stubEnv('VITE_DEPLOY', 'aws');
    setStorageUser('sub-a');
    b.local.setItem('quizzer_stats', '{}');
    setActiveDataset(datasetKey('hosted', 'aws-dva-c02', BUNDLED_DATASET_KEY));
    expect(b.local.getItem('quizzer_stats')).toBe('{}');
  });
  it('AWS build: source lists are per user and never store the hosted source', () => {
    vi.stubEnv('VITE_DEPLOY', 'aws');
    setStorageUser('sub-a');
    saveSources([GH_PRIV, hostedSource()]);
    expect(b.local.getItem('quizzer_sources:u:sub-a')).toContain('gh-2');
    expect(loadSources().map((s) => s.id)).toEqual(['gh-2']);
    setStorageUser('sub-b');
    expect(loadSources()).toEqual([]);
  });
});

describe('hosted source loading (aws build)', () => {
  beforeEach(() => { vi.stubEnv('VITE_DEPLOY', 'aws'); setCurrentSession(SESSION); });

  it('lists session.ds via data/<id>/index.json; 403 → "non abilitato"', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/aws-dva-c02/index.json') return json(200, { schemaVersion: 1, datasets: [{ id: 'aws-dva-c02', title: 'AWS', file: 'questions.json', questions: 2 }] });
      if (url === '/data/mule-mcd-01/index.json') return json(403, { error: 'dataset-not-enabled' });
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    const l = await loadHostedIndex();
    expect(l[0]).toEqual({ id: 'aws-dva-c02', entry: { id: 'aws-dva-c02', title: 'AWS', file: 'aws-dva-c02/questions.json', questions: 2 } });
    expect(l[1].id).toBe('mule-mcd-01');
    expect(l[1].error).toMatch(/non abilitato/);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).credentials === 'same-origin')).toBe(true);
    expect((await loadIndex(hostedSource())).map((e) => e.id)).toEqual(['aws-dva-c02']);
  });

  it('ds = [*] uses allDatasets', async () => {
    setCurrentSession({ ...SESSION, ds: ['*'], allDatasets: ['mule-mcd-01'] });
    const fetchMock = vi.fn(async () => json(200, { schemaVersion: 1, datasets: [{ id: 'mule-mcd-01', title: 'MCD', file: 'questions.json' }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await loadHostedIndex()).map((l) => l.entry?.file)).toEqual(['mule-mcd-01/questions.json']);
    expect(fetchMock).toHaveBeenCalledWith('/data/mule-mcd-01/index.json', expect.anything());
  });

  it('questions.json images resolve to plain /data URLs (no blob, no sentinel)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [
      { id: 1, text: 'Q', selectCount: 1, image: 'images/q001.jpeg', options: [{ text: '', correct: true, image: 'images/q001_A.jpeg' }, { text: 'b', correct: false }] },
    ])));
    const qs = await loadDataset(hostedSource(), { id: 'mule-mcd-01', title: 'MCD', file: 'mule-mcd-01/questions.json' });
    expect(qs[0].image).toBe('/data/mule-mcd-01/images/q001.jpeg');
    expect(qs[0].options[0].image).toBe('/data/mule-mcd-01/images/q001_A.jpeg');
  });
});
