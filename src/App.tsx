import { useState, useCallback } from 'react';
import type { Mode, SessionConfig, SessionResult, SessionRecord, Question, Stats, PracticeSessionDraft } from './types';
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

type Screen =
  | { name: 'home' }
  | { name: 'config'; mode: Mode }
  | { name: 'session'; mode: Mode; config: SessionConfig; questions: Question[]; draft?: PracticeSessionDraft }
  | { name: 'results'; result: SessionResult }
  | { name: 'history' }
  | { name: 'review'; record: SessionRecord }
  | { name: 'dataset' };

const IMPORTED_QUESTIONS_KEY = 'quizzer_imported_questions';
const NOTES_KEY = 'quizzer_notes';
export const STATS_KEY = 'quizzer_stats';
export const SESSIONS_KEY = 'quizzer_sessions';
export const PRACTICE_DRAFT_KEY = 'quizzer_practice_draft';
const MAX_SESSIONS = 100;

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
  if (bundledCache) return bundledCache;
  try {
    const mod = await import('./data/questions.json');
    bundledCache = mod.default as Question[];
    return bundledCache;
  } catch { return []; }
}

function loadFromStorage(): Question[] | null {
  const parsed = readJSON<Question[]>(IMPORTED_QUESTIONS_KEY, []);
  return parsed.length > 0 ? parsed : null;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [allQuestions, setAllQuestions] = useState<Question[]>(() => loadFromStorage() ?? []);
  const [loadError, setLoadError] = useState(false);
  const [isImported, setIsImported] = useState(() => loadFromStorage() !== null);

  const ensureLoaded = useCallback(async () => {
    if (allQuestions.length > 0) return allQuestions;
    const qs = await loadBundled();
    if (qs.length === 0) setLoadError(true);
    setAllQuestions(qs);
    return qs;
  }, [allQuestions]);

  const handleSelectMode = useCallback(
    async (mode: Mode) => { await ensureLoaded(); setScreen({ name: 'config', mode }); },
    [ensureLoaded],
  );

  const handleSetQuestions = useCallback((questions: Question[], persist: boolean) => {
    if (persist) { localStorage.setItem(IMPORTED_QUESTIONS_KEY, JSON.stringify(questions)); setIsImported(true); }
    setAllQuestions(questions);
    setLoadError(false);
  }, []);

  const handleClearImported = useCallback(() => {
    localStorage.removeItem(IMPORTED_QUESTIONS_KEY);
    setIsImported(false);
    setAllQuestions([]);
    loadBundled().then((qs) => { setAllQuestions(qs); if (qs.length === 0) setLoadError(true); });
  }, []);

  const handleBackup = useCallback(() => {
    downloadJSON(
      {
        version: 2,
        exportedAt: new Date().toISOString(),
        questions: allQuestions,
        notes: readJSON(NOTES_KEY, {}),
        stats: readJSON(STATS_KEY, {}),
      },
      `quizzer-backup-${new Date().toISOString().slice(0, 10)}.json`,
    );
  }, [allQuestions]);

  const handleExportNotes = useCallback(() => {
    const notes = readJSON<Record<string, string>>(NOTES_KEY, {});
    const md = exportNotesMarkdown(allQuestions, notes);
    downloadBlob(md, `quizzer-notes-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
  }, [allQuestions]);

  const handleImportNotes = useCallback((text: string): { matched: number; total: number } => {
    const existing = readJSON<Record<string, string>>(NOTES_KEY, {});
    const { notes, matched, total } = importNotesMarkdown(text, allQuestions);
    const merged = { ...existing, ...notes };
    localStorage.setItem(NOTES_KEY, JSON.stringify(merged));
    return { matched, total };
  }, [allQuestions]);

  const handleExportStats = useCallback(() => {
    const stats = readJSON<Stats>(STATS_KEY, {});
    const md = exportStatsMarkdown(allQuestions, stats);
    downloadBlob(md, `quizzer-stats-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
  }, [allQuestions]);

  const handleImportStats = useCallback((text: string): { matched: number; total: number } => {
    const existing = readJSON<Stats>(STATS_KEY, {});
    const { stats, matched, total } = importStatsMarkdown(text, allQuestions);
    const merged = { ...existing, ...stats };
    localStorage.setItem(STATS_KEY, JSON.stringify(merged));
    setScreen((s) => ({ ...s }));
    return { matched, total };
  }, [allQuestions]);

  const handleRestoreData = useCallback((data: {
    questions?: Question[];
    notes?: Record<string, string>;
    stats?: Stats;
  }) => {
    if (data.questions) {
      localStorage.setItem(IMPORTED_QUESTIONS_KEY, JSON.stringify(data.questions));
      setIsImported(true);
      setAllQuestions(data.questions);
      setLoadError(false);
    }
    if (data.notes) localStorage.setItem(NOTES_KEY, JSON.stringify(data.notes));
    if (data.stats) localStorage.setItem(STATS_KEY, JSON.stringify(data.stats));
  }, []);

  const handleResetStats = useCallback(() => {
    localStorage.removeItem(STATS_KEY);
    setScreen((s) => ({ ...s }));
  }, []);

  const handleResetStat = useCallback((qId: number) => {
    const stats = readJSON<Stats>(STATS_KEY, {});
    delete stats[String(qId)];
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    setScreen((s) => ({ ...s }));
  }, []);

  const handleClearHistory = useCallback(() => {
    localStorage.removeItem(SESSIONS_KEY);
  }, []);

  const handleStartSession = useCallback(
    (mode: Mode, config: SessionConfig) => {
      const stats = readJSON<Stats>(STATS_KEY, {});

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
      localStorage.removeItem(PRACTICE_DRAFT_KEY);
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
    if (result.mode === 'practice') localStorage.removeItem(PRACTICE_DRAFT_KEY);

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
      const prev = readJSON<SessionRecord[]>(SESSIONS_KEY, []);
      const updated = [record, ...prev].slice(0, MAX_SESSIONS);
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(updated));
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
  const handleRetry = useCallback((result: SessionResult) => {
    setScreen({ name: 'config', mode: result.mode });
  }, []);

  if (screen.name === 'home') {
    return (
      <HomeScreen
        questionCount={allQuestions.length}
        loadError={loadError}
        isImported={isImported}
        onSelectMode={handleSelectMode}
        onSetQuestions={handleSetQuestions}
        onClearImported={handleClearImported}
        onBackup={handleBackup}
        onRestoreData={handleRestoreData}
        onResetStats={handleResetStats}
        onHistory={handleHistory}
        onDataset={handleDataset}
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
        sessionsKey={SESSIONS_KEY}
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
    const stats = readJSON<Stats>(STATS_KEY, {});
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
    const draft = readJSON<PracticeSessionDraft | null>(PRACTICE_DRAFT_KEY, null);
    const stats = readJSON<Stats>(STATS_KEY, {});
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

  return null;
}
