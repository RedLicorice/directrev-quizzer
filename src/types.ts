export interface Option {
  text: string;
  correct: boolean;
}

export interface Question {
  id: number;
  text: string;
  options: Option[];
  selectCount: number;
}

export type Mode = 'exam' | 'practice' | 'flashcard';

export interface SessionConfig {
  timeLimit: number;   // minutes; 0 = no limit
  passingScore: number; // 0-100 percent
  questionCount: number;
  shuffle: boolean;
}

export interface SessionResult {
  mode: Mode;
  questions: Question[];
  answers: Record<number, number[]>; // questionIndex → selected option indices
  config: SessionConfig;
  timeElapsed: number; // seconds
}

export const DEFAULT_CONFIGS: Record<Mode, SessionConfig> = {
  exam: { timeLimit: 130, passingScore: 72, questionCount: 65, shuffle: true },
  practice: { timeLimit: 0, passingScore: 72, questionCount: 65, shuffle: true },
  flashcard: { timeLimit: 0, passingScore: 0, questionCount: 50, shuffle: true },
};
