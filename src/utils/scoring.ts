import type { Question, SessionResult } from '../types';

export function isAnswerCorrect(question: Question, selectedIndices: number[]): boolean {
  const correctIndices = question.options
    .map((o, i) => (o.correct ? i : -1))
    .filter((i) => i !== -1);

  if (selectedIndices.length !== correctIndices.length) return false;
  const sorted = [...selectedIndices].sort();
  const expected = [...correctIndices].sort();
  return sorted.every((v, i) => v === expected[i]);
}

export function calculateScore(result: SessionResult): {
  correct: number;
  total: number;
  percentage: number;
  passed: boolean;
} {
  let correct = 0;
  for (let i = 0; i < result.questions.length; i++) {
    const ans = result.answers[i] ?? [];
    if (isAnswerCorrect(result.questions[i], ans)) correct++;
  }
  const total = result.questions.length;
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
  return { correct, total, percentage, passed: percentage >= result.config.passingScore };
}
