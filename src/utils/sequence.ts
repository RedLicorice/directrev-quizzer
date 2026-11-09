import type { Question } from '../types';

/** The number a learner sees for a question: its source number when the dataset has one. */
export function displayNumber(q: Question): string {
  return q.sourceNumber ?? String(q.id);
}

/** Dataset order: ascending id, whatever order the questions arrived in. */
function datasetOrder(all: Question[]): Question[] {
  return [...all].sort((a, b) => a.id - b.id);
}

/** Index of the question numbered `startFrom`, or 0 when unset or not found. */
export function findStartIndex(all: Question[], startFrom: number | undefined): number {
  if (startFrom === undefined) return 0;
  const wanted = String(startFrom);
  const idx = datasetOrder(all).findIndex((q) => displayNumber(q) === wanted);
  return idx < 0 ? 0 : idx;
}

/** How many questions follow the start point (all of them when unset or not found). */
export function remainingFrom(all: Question[], startFrom: number | undefined): number {
  return datasetOrder(all).length - findStartIndex(all, startFrom);
}

/** `count` questions in dataset order from `startFrom` (first question when unset/not found). */
export function sequentialQuestions(all: Question[], startFrom: number | undefined, count: number): Question[] {
  const ordered = datasetOrder(all);
  const start = findStartIndex(all, startFrom);
  return ordered.slice(start, start + Math.max(count, 0));
}
