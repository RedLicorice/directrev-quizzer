import type { ExamRules, Mode, SessionConfig } from '../types';
import { DEFAULT_CONFIGS } from '../types';

/**
 * Defaults for a session: the dataset's official exam format (when it carries one)
 * overrides the global defaults. Exam and Practice get the exam question count and
 * passing score; only Exam gets the time limit. Flashcard keeps its own deck size.
 */
export function defaultsForDataset(mode: Mode, rules?: ExamRules | null): SessionConfig {
  const base: SessionConfig = { ...DEFAULT_CONFIGS[mode] };
  if (!rules || mode === 'flashcard') return base;
  if (typeof rules.questionCount === 'number' && rules.questionCount > 0) base.questionCount = rules.questionCount;
  if (typeof rules.passPercent === 'number' && rules.passPercent > 0) base.passingScore = rules.passPercent;
  if (mode === 'exam' && typeof rules.durationMinutes === 'number' && rules.durationMinutes > 0) base.timeLimit = rules.durationMinutes;
  return base;
}

/** Short human description of the official format, or null when there is no metadata. */
export function examRulesSummary(rules?: ExamRules | null): string | null {
  if (!rules) return null;
  const parts: string[] = [];
  if (rules.questionCount) parts.push(`${rules.questionCount} domande`);
  if (rules.durationMinutes) parts.push(`${rules.durationMinutes} min`);
  if (rules.passPercent) parts.push(`${rules.passPercent}%`);
  if (rules.unscoredMax) parts.push(`+ fino a ${rules.unscoredMax} non valutate`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
