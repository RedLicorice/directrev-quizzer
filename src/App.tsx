import { useState, useCallback } from 'react';
import type { Mode, SessionConfig, SessionResult, Question, Stats } from './types';
import { DEFAULT_CONFIGS } from './types';
import { shuffle } from './utils/shuffle';
import { weightedSample } from './utils/weightedSample';
import HomeScreen from './components/HomeScreen';
import ConfigScreen from './components/ConfigScreen';
import ExamSession from './components/ExamSession';
import PracticeSession from './components/PracticeSession';
import FlashcardSession from './components/FlashcardSession';
import ResultsScreen from './components/ResultsScreen';

type Screen =
  | { name: 'home' }
  | { name: 'config'; mode: Mode }
  | { name: 'session'; mode: Mode; config: SessionConfig; questions: Question[] }
  | { name: 'results'; result: SessionResult };

const IMPORTED_QUESTIONS_KEY = 'quizzer_imported_questions';
const NOTES_KEY = 'quizzer_notes';
export const STATS_KEY = 'quizzer_stats';

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  }, []);

  const handleStartSession = useCallback(
    (mode: Mode, config: SessionConfig) => {
      let qs: Question[];
      if (mode === 'practice' && config.bias !== 0.5) {
        const stats = readJSON<Stats>(STATS_KEY, {});
        qs = weightedSample(allQuestions, stats, config.bias, config.questionCount);
      } else {
        qs = config.shuffle ? shuffle(allQuestions) : allQuestions.slice();
        qs = qs.slice(0, config.questionCount);
      }
      setScreen({ name: 'session', mode, config, questions: qs });
    },
    [allQuestions],
  );

  const handleSessionEnd = useCallback((result: SessionResult) => {
    if (result.mode === 'flashcard') setScreen({ name: 'home' });
    else setScreen({ name: 'results', result });
  }, []);

  const handleHome = useCallback(() => setScreen({ name: 'home' }), []);
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
        defaultConfigs={DEFAULT_CONFIGS}
      />
    );
  }

  if (screen.name === 'config') {
    return (
      <ConfigScreen
        mode={screen.mode}
        totalQuestions={allQuestions.length}
        onStart={handleStartSession}
        onBack={handleHome}
      />
    );
  }

  if (screen.name === 'session') {
    if (screen.mode === 'exam') {
      return <ExamSession questions={screen.questions} config={screen.config} onFinish={handleSessionEnd} onExit={handleHome} />;
    }
    if (screen.mode === 'practice') {
      return <PracticeSession questions={screen.questions} config={screen.config} onFinish={handleSessionEnd} onExit={handleHome} />;
    }
    return <FlashcardSession questions={screen.questions} onExit={handleHome} />;
  }

  if (screen.name === 'results') {
    return <ResultsScreen result={screen.result} onHome={handleHome} onRetry={handleRetry} />;
  }

  return null;
}
