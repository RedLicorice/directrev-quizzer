import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { Mode, SessionConfig, SessionResult, SessionRecord, Question, Stats, PracticeSessionDraft, SourceConfig, DatasetEntry } from './types';
import { DEFAULT_CONFIGS } from './types';
import { shuffle } from './utils/shuffle';
import { weightedSample } from './utils/weightedSample';
import { isAnswerCorrect } from './utils/scoring';
import { exportNotesMarkdown, importNotesMarkdown, isNotesMarkdown, exportStatsMarkdown, importStatsMarkdown, isStatsMarkdown } from './utils/notesMarkdown';
import HomeScreen from './components/HomeScreen';
import ConfigScreen from './components/ConfigScreen';
import ExamSession from './components/ExamSession';
import PracticeSession from './components/PracticeSession';
import FlashcardSession from './components/FlashcardSession';
import ResultsScreen from './components/ResultsScreen';
import SessionHistoryScreen from './components/SessionHistoryScreen';
import SessionReviewScreen from './components/SessionReviewScreen';
import DatasetScreen from './components/DatasetScreen';
import { setActiveDataset, statsKey, notesKey, sessionsKey, practiceDraftKey, userScoped, BUNDLED_DATASET_KEY } from './utils/storage';
import { BUNDLED_SOURCE_ID, HOSTED_SOURCE_ID, hostedSource, loadSources, loadActive, saveActive, loadIndex, loadDataset, datasetKey } from './utils/datasets';
import type { ActiveRef } from './utils/datasets';

type Screen =
  | { name: 'home' }
  | { name: 'config'; mode: Mode }
  | { name: 'session'; mode: Mode; config: SessionConfig; questions: Question[]; draft?: PracticeSessionDraft }
  | { name: 'results'; result: SessionResult }
  | { name: 'history' }
  | { name: 'review'; record: SessionRecord }
  | { name: 'admin' }
  | { name: 'dataset' };

// AWS build only: the dynamic import lives inside a plain `if` so Vite drops it from the
// Pages build entirely (same pattern as AuthGate in main.tsx), keeping /auth and /api/admin
// out of the public bundle.
type AdminScreenProps = { onBack: () => void };
let AdminScreen: LazyExoticComponent<ComponentType<AdminScreenProps>> | null = null;
if (import.meta.env.VITE_DEPLOY === 'aws') {
  AdminScreen = lazy(() => import('./aws/admin/AdminScreen'));
}

const MAX_SESSIONS = 100;
const BUNDLED_TITLE = 'AWS Certified Developer Associate (DVA-C02)';
const IMPORTED_FILE_KEY = 'imported-file';
const BUNDLED_REF: ActiveRef = { sourceId: BUNDLED_SOURCE_ID, datasetId: BUNDLED_DATASET_KEY };

/** AWS build: no bundled dataset; the first dataset of the hosted source is the default. */
const NO_DATASET_REF: ActiveRef = { sourceId: HOSTED_SOURCE_ID, datasetId: '' };

function defaultRef(): ActiveRef {
  return import.meta.env.VITE_DEPLOY === 'aws' ? NO_DATASET_REF : BUNDLED_REF;
}

function initialActive(): ActiveRef {
  const ref = loadActive() ?? defaultRef();
  setActiveDataset(datasetKey(ref.sourceId, ref.datasetId, BUNDLED_DATASET_KEY));
  return ref;
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadJSON(data: unknown, filename: string) {
  downloadBlob(JSON.stringify(data, null, 2), filename, 'application/json');
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

let bundledCache: Question[] | null = null;
async function loadBundled(): Promise<Question[]> {
  // The AWS build hides the bundled dataset (same id as the hosted aws-dva-c02, separate
  // progress would be confusing) and does not even ship it: the chunk is tree-shaken away.
  if (import.meta.env.VITE_DEPLOY === 'aws') return [];
  if (bundledCache) return bundledCache;
  try {
    const mod = await import('./data/questions.json');
    bundledCache = mod.default as Question[];
    return bundledCache;
  } catch { return []; }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [isImported, setIsImported] = useState(false); // questions loaded from a file for this session only
  const [active, setActive] = useState<ActiveRef>(initialActive);
  const [datasetTitle, setDatasetTitle] = useState(import.meta.env.VITE_DEPLOY === 'aws' ? 'Quizzer' : BUNDLED_TITLE);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetError, setDatasetError] = useState<string | null>(null);

  const activateBundled = useCallback(async (): Promise<boolean> => {
    const qs = await loadBundled();
    setActiveDataset(BUNDLED_DATASET_KEY);
    saveActive(BUNDLED_REF);
    setActive(BUNDLED_REF);
    setDatasetTitle(BUNDLED_TITLE);
    setAllQuestions(qs);
    setIsImported(false);
    setLoadError(qs.length === 0);
    return qs.length > 0;
  }, []);

  /** Loads a dataset from the bundled data (src = null) or from a configured source. */
  const openDataset = useCallback(async (src: SourceConfig | null, entry: DatasetEntry) => {
    setDatasetLoading(true);
    setDatasetError(null);
    try {
      if (!src) { await activateBundled(); return true; }
      const qs = await loadDataset(src, entry);
      const ref: ActiveRef = { sourceId: src.id, datasetId: entry.id };
      setActiveDataset(datasetKey(ref.sourceId, ref.datasetId, BUNDLED_DATASET_KEY));
      saveActive(ref);
      setActive(ref);
      setDatasetTitle(entry.title);
      setAllQuestions(qs);
      setIsImported(false);
      setLoadError(false);
      return true;
    } catch (e) {
      setDatasetError(`${src?.name ?? 'Dataset'}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setDatasetLoading(false);
    }
  }, [activateBundled]);

  /** AWS build: open the remembered hosted dataset, else the first one the session allows. */
  const restoreHosted = useCallback(async () => {
    if (import.meta.env.VITE_DEPLOY !== 'aws') return;
    const ref = loadActive();
    setDatasetLoading(true);
    let entries: DatasetEntry[] = [];
    try {
      const src = ref && ref.sourceId !== HOSTED_SOURCE_ID ? loadSources().find((s) => s.id === ref.sourceId) : undefined;
      if (src) {
        const entry = (await loadIndex(src)).find((d) => d.id === ref!.datasetId);
        if (entry) { setDatasetLoading(false); await openDataset(src, entry); return; }
      }
      entries = await loadIndex(hostedSource());
    } catch (e) {
      setDatasetError(e instanceof Error ? e.message : String(e));
    }
    setDatasetLoading(false);
    const entry = entries.find((d) => ref?.sourceId === HOSTED_SOURCE_ID && d.id === ref.datasetId) ?? entries[0];
    if (entry) { await openDataset(hostedSource(), entry); return; }
    setAllQuestions([]);
    setDatasetTitle('Nessun dataset disponibile');
    setLoadError(false);
  }, [openDataset]);

  /** (Re)loads whatever dataset was last active, falling back to the bundled one. */
  const restoreActive = useCallback(async () => {
    if (import.meta.env.VITE_DEPLOY === 'aws') { await restoreHosted(); return; }
    const ref = loadActive() ?? BUNDLED_REF;
    if (ref.sourceId === BUNDLED_SOURCE_ID) { await activateBundled(); return; }
    const src = loadSources().find((s) => s.id === ref.sourceId);
    setDatasetLoading(true);
    try {
      if (!src) throw new Error('source no longer configured');
      const entry = (await loadIndex(src)).find((d) => d.id === ref.datasetId);
      if (!entry) throw new Error(`dataset "${ref.datasetId}" not found in index.json`);
      setDatasetLoading(false);
      await openDataset(src, entry);
    } catch (e) {
      setDatasetLoading(false);
      await activateBundled();
      setDatasetError(`Could not load "${ref.datasetId}" (${e instanceof Error ? e.message : String(e)}). Showing the bundled dataset instead.`);
    }
  }, [activateBundled, openDataset, restoreHosted]);

  useEffect(() => { void restoreActive(); }, [restoreActive]);

  const ensureLoaded = useCallback(async () => allQuestions, [allQuestions]);

  const handleSelectMode = useCallback(
    async (mode: Mode) => { await ensureLoaded(); setScreen({ name: 'config', mode }); },
    [ensureLoaded],
  );

  /** Questions loaded from a file are kept in memory only, with their own progress bucket. */
  const handleSetQuestions = useCallback((questions: Question[]) => {
    setActiveDataset(userScoped(IMPORTED_FILE_KEY));
    setDatasetTitle('Imported file (this session only)');
    setAllQuestions(questions);
    setIsImported(true);
    setLoadError(false);
  }, []);

  const handleClearImported = useCallback(() => { void restoreActive(); }, [restoreActive]);

  const handleBackup = useCallback(() => {
    downloadJSON(
      {
        version: 3,
        dataset: datasetKey(active.sourceId, active.datasetId, BUNDLED_DATASET_KEY),
        exportedAt: new Date().toISOString(),
        notes: readJSON(notesKey(), {}),
        stats: readJSON(statsKey(), {}),
      },
      `quizzer-backup-${new Date().toISOString().slice(0, 10)}.json`,
    );
  }, [active]);

  const handleExportNotes = useCallback(() => {
    const notes = readJSON<Record<string, string>>(notesKey(), {});
    const md = exportNotesMarkdown(allQuestions, notes);
    downloadBlob(md, `quizzer-notes-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
  }, [allQuestions]);

  const handleImportNotes = useCallback((text: string): { matched: number; total: number } => {
    const existing = readJSON<Record<string, string>>(notesKey(), {});
    const { notes, matched, total } = importNotesMarkdown(text, allQuestions);
    const merged = { ...existing, ...notes };
    localStorage.setItem(notesKey(), JSON.stringify(merged));
    return { matched, total };
  }, [allQuestions]);

  const handleExportStats = useCallback(() => {
    const stats = readJSON<Stats>(statsKey(), {});
    const md = exportStatsMarkdown(allQuestions, stats);
    downloadBlob(md, `quizzer-stats-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
  }, [allQuestions]);

  const handleImportStats = useCallback((text: string): { matched: number; total: number } => {
    const existing = readJSON<Stats>(statsKey(), {});
    const { stats, matched, total } = importStatsMarkdown(text, allQuestions);
    const merged = { ...existing, ...stats };
    localStorage.setItem(statsKey(), JSON.stringify(merged));
    setScreen((s) => ({ ...s }));
    return { matched, total };
  }, [allQuestions]);

  const handleRestoreData = useCallback((data: {
    questions?: Question[];
    notes?: Record<string, string>;
    stats?: Stats;
  }) => {
    if (data.questions) handleSetQuestions(data.questions);
    if (data.notes) localStorage.setItem(notesKey(), JSON.stringify(data.notes));
    if (data.stats) localStorage.setItem(statsKey(), JSON.stringify(data.stats));
  }, [handleSetQuestions]);

  const handleResetStats = useCallback(() => {
    localStorage.removeItem(statsKey());
    setScreen((s) => ({ ...s }));
  }, []);

  const handleResetStat = useCallback((qId: number) => {
    const stats = readJSON<Stats>(statsKey(), {});
    delete stats[String(qId)];
    localStorage.setItem(statsKey(), JSON.stringify(stats));
    setScreen((s) => ({ ...s }));
  }, []);

  const handleClearHistory = useCallback(() => {
    localStorage.removeItem(sessionsKey());
  }, []);

  const handleStartSession = useCallback(
    (mode: Mode, config: SessionConfig) => {
      const stats = readJSON<Stats>(statsKey(), {});

      // Pre-filter pool for weak mode (practice only)
      let pool = allQuestions;
      if (mode === 'practice' && config.weakMode) {
        const weak = allQuestions.filter((q) => {
          const s = stats[String(q.id)];
          if (!s || s.correct + s.wrong === 0) return true;
          return s.correct / (s.correct + s.wrong) < 0.6;
        });
        pool = weak.length > 0 ? weak : allQuestions;
      }

      // Effective per-answer bias (practice only; weak mode forces 1.0)
      const effectiveBias = mode === 'practice'
        ? (config.weakMode ? 1.0 : config.bias)
        : 0.5;

      const { seenBias } = config;
      let qs: Question[];

      if (seenBias !== 0.5 || effectiveBias !== 0.5) {
        qs = weightedSample(pool, stats, effectiveBias, seenBias, config.questionCount);
      } else {
        qs = config.shuffle ? shuffle(pool) : pool.slice();
        qs = qs.slice(0, config.questionCount);
      }

      setScreen({ name: 'session', mode, config, questions: qs });
    },
    [allQuestions],
  );

  const handleResumePractice = useCallback((draft: PracticeSessionDraft) => {
    const questionMap = new Map(allQuestions.map((q) => [q.id, q]));
    const questions = draft.questionIds.map((id) => questionMap.get(id)).filter(Boolean) as Question[];
    if (questions.length === 0) {
      localStorage.removeItem(practiceDraftKey());
      return;
    }
    setScreen({ name: 'session', mode: 'practice', config: draft.config, questions, draft });
  }, [allQuestions]);

  const handleImportSession = useCallback((data: unknown) => {
    try {
      const exp = data as { type: string; questions: Question[]; config: SessionConfig; currentIdx: number; answers: Record<number, number[]>; revealed: number[]; startTime: number };
      if (exp.type !== 'practice-session' || !Array.isArray(exp.questions)) return false;
      const draft: PracticeSessionDraft = {
        id: String(Date.now()),
        savedAt: new Date().toISOString(),
        questionIds: exp.questions.map((q) => q.id),
        config: exp.config,
        currentIdx: exp.currentIdx ?? 0,
        answers: exp.answers ?? {},
        revealed: exp.revealed ?? [],
        startTime: exp.startTime ?? Date.now(),
      };
      // Store the full questions temporarily via the export questions
      // We rebuild question list from the imported data
      const qs = exp.questions;
      setScreen({ name: 'session', mode: 'practice', config: exp.config, questions: qs, draft });
      return true;
    } catch { return false; }
  }, []);

  const handleSessionEnd = useCallback((result: SessionResult) => {
    // Clear any draft when session finishes
    if (result.mode === 'practice') localStorage.removeItem(practiceDraftKey());

    if (result.mode !== 'flashcard') {
      const correctCount = result.questions.filter((q, i) => isAnswerCorrect(q, result.answers[i] ?? [])).length;
      const record: SessionRecord = {
        id: String(Date.now()),
        mode: result.mode,
        date: new Date().toISOString(),
        questions: result.questions,
        answers: result.answers,
        config: result.config,
        timeElapsed: result.timeElapsed,
        correctCount,
      };
      const prev = readJSON<SessionRecord[]>(sessionsKey(), []);
      const updated = [record, ...prev].slice(0, MAX_SESSIONS);
      localStorage.setItem(sessionsKey(), JSON.stringify(updated));
      setScreen({ name: 'results', result });
    } else {
      setScreen({ name: 'home' });
    }
  }, []);

  const handlePracticeExit = useCallback(() => {
    // Don't clear draft on exit — user can resume later
    setScreen({ name: 'home' });
  }, []);

  const handleHome = useCallback(() => setScreen({ name: 'home' }), []);
  const handleHistory = useCallback(() => setScreen({ name: 'history' }), []);
  const handleDataset = useCallback(() => setScreen({ name: 'dataset' }), []);
  const handleAdmin = useCallback(() => setScreen({ name: 'admin' }), []);
  const handleRetry = useCallback((result: SessionResult) => {
    setScreen({ name: 'config', mode: result.mode });
  }, []);

  if (screen.name === 'home') {
    return (
      <HomeScreen
        questionCount={allQuestions.length}
        loadError={loadError}
        isImported={isImported}
        datasetTitle={datasetTitle}
        active={active}
        datasetLoading={datasetLoading}
        datasetError={datasetError}
        onOpenDataset={openDataset}
        onSelectMode={handleSelectMode}
        onSetQuestions={handleSetQuestions}
        onClearImported={handleClearImported}
        onBackup={handleBackup}
        onRestoreData={handleRestoreData}
        onResetStats={handleResetStats}
        onHistory={handleHistory}
        onDataset={handleDataset}
        onAdmin={handleAdmin}
        onExportNotes={handleExportNotes}
        onImportNotes={handleImportNotes}
        onExportStats={handleExportStats}
        onImportStats={handleImportStats}
        defaultConfigs={DEFAULT_CONFIGS}
        isNotesMarkdown={isNotesMarkdown}
        isStatsMarkdown={isStatsMarkdown}
      />
    );
  }

  if (screen.name === 'history') {
    return (
      <SessionHistoryScreen
        sessionsKey={sessionsKey()}
        onBack={handleHome}
        onOpen={(record) => setScreen({ name: 'review', record })}
        onClearHistory={handleClearHistory}
      />
    );
  }

  if (screen.name === 'review') {
    return (
      <SessionReviewScreen
        record={screen.record}
        onBack={handleHistory}
      />
    );
  }

  if (screen.name === 'dataset') {
    const stats = readJSON<Stats>(statsKey(), {});
    return (
      <DatasetScreen
        questions={allQuestions}
        stats={stats}
        onBack={handleHome}
        onResetStat={handleResetStat}
        onResetAllStats={handleResetStats}
      />
    );
  }

  if (screen.name === 'config') {
    const draft = readJSON<PracticeSessionDraft | null>(practiceDraftKey(), null);
    const stats = readJSON<Stats>(statsKey(), {});
    const seenCount = allQuestions.filter((q) => {
      const s = stats[String(q.id)];
      return s && s.correct + s.wrong > 0;
    }).length;
    return (
      <ConfigScreen
        mode={screen.mode}
        totalQuestions={allQuestions.length}
        seenCount={seenCount}
        savedDraft={screen.mode === 'practice' ? draft : null}
        onStart={handleStartSession}
        onResume={handleResumePractice}
        onImportSession={handleImportSession}
        onBack={handleHome}
      />
    );
  }

  if (screen.name === 'session') {
    if (screen.mode === 'exam') {
      return <ExamSession questions={screen.questions} config={screen.config} onFinish={handleSessionEnd} onExit={handleHome} />;
    }
    if (screen.mode === 'practice') {
      return (
        <PracticeSession
          questions={screen.questions}
          config={screen.config}
          initialDraft={screen.draft}
          onFinish={handleSessionEnd}
          onExit={handlePracticeExit}
        />
      );
    }
    return <FlashcardSession questions={screen.questions} onExit={handleHome} />;
  }

  if (screen.name === 'results') {
    return <ResultsScreen result={screen.result} onHome={handleHome} onRetry={handleRetry} />;
  }

  if (screen.name === 'admin') {
    if (!AdminScreen) return null; // never reachable in the Pages build
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">Caricamento…</div>}>
        <AdminScreen onBack={handleHome} />
      </Suspense>
    );
  }

  return null;
}
