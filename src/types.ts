export interface Option {
  text: string;
  correct: boolean;
  image?: string; // base64 data URL
}

export interface Question {
  id: number;
  text: string;
  options: Option[];
  selectCount: number;
  image?: string; // data URL or URL (relative paths are resolved when a dataset is loaded)
  explanation?: string;      // markdown, maintained in the dataset repo
  explanationImage?: string; // data URL or URL
}

// ── Dataset sources ─────────────────────────────────────────────────────────

/** Where datasets are loaded from: a (possibly private) GitHub repo, or any static HTTP location. */
export interface SourceConfig {
  id: string;
  name: string;
  kind: 'github' | 'url';
  repo?: string;   // github: "owner/name"
  ref?: string;    // github: branch, tag or commit (default "main")
  path?: string;   // github: sub-directory holding index.json ("" = repo root)
  token?: string;  // github: read-only token for private repos (stored locally)
  url?: string;    // url: base URL of the folder holding index.json
}

export interface DatasetEntry {
  id: string;
  title: string;
  file: string;       // path of questions.json relative to index.json
  questions?: number;
  images?: number;
  source?: string;    // free text / URL describing where the questions come from
}

export interface DatasetIndex {
  schemaVersion: number;
  datasets: DatasetEntry[];
}

export type Mode = 'exam' | 'practice' | 'flashcard';

export interface SessionConfig {
  timeLimit: number;    // minutes; 0 = no limit
  passingScore: number; // 0-100 percent
  questionCount: number;
  shuffle: boolean;
  bias: number;         // 0.0 = favour mastered, 0.5 = balanced, 1.0 = favour struggling (practice only)
  weakMode: boolean;    // only pick questions with success rate < 60% or unseen (practice only)
  seenBias: number;     // 0.0 = seen only, 0.5 = mixed (default), 1.0 = unseen only (all modes)
}

export interface SessionResult {
  mode: Mode;
  questions: Question[];
  answers: Record<number, number[]>; // questionIndex → selected option indices
  config: SessionConfig;
  timeElapsed: number; // seconds
}

export interface SessionRecord {
  id: string;           // timestamp string used as unique id
  mode: Mode;
  date: string;         // ISO date string
  questions: Question[];
  answers: Record<number, number[]>;
  config: SessionConfig;
  timeElapsed: number;
  correctCount: number; // pre-computed for list display
}

export interface QuestionStat {
  correct: number;
  wrong: number;
}

// Keyed by String(question.id)
export type Stats = Record<string, QuestionStat>;

export interface PracticeSessionDraft {
  id: string;
  savedAt: string;
  questionIds: number[]; // ordered IDs of questions in this session
  config: SessionConfig;
  currentIdx: number;
  answers: Record<number, number[]>;
  revealed: number[]; // array form of Set<number>
  startTime: number;  // ms timestamp
}

// Full exportable session (includes question data for portability)
export interface PracticeSessionExport {
  version: 1;
  type: 'practice-session';
  exportedAt: string;
  questions: Question[];
  config: SessionConfig;
  currentIdx: number;
  answers: Record<number, number[]>;
  revealed: number[];
  startTime: number;
}

export const DEFAULT_CONFIGS: Record<Mode, SessionConfig> = {
  exam:      { timeLimit: 130, passingScore: 72, questionCount: 65, shuffle: true,  bias: 0.5, weakMode: false, seenBias: 0.5 },
  practice:  { timeLimit: 0,   passingScore: 72, questionCount: 65, shuffle: true,  bias: 0.5, weakMode: false, seenBias: 0.5 },
  flashcard: { timeLimit: 0,   passingScore: 0,  questionCount: 50, shuffle: true,  bias: 0.5, weakMode: false, seenBias: 0.5 },
};
