import type { Question, Stats } from '../types';
import { shuffle } from './shuffle';

function isSeen(q: Question, stats: Stats): boolean {
  const s = stats[String(q.id)];
  return Boolean(s && s.correct + s.wrong > 0);
}

/**
 * Sample `count` questions from `questions` weighted by correct/wrong history.
 * bias = 0.0 → favour mastered | 0.5 → uniform | 1.0 → favour struggling
 */
function biasWeightedSample(questions: Question[], stats: Stats, bias: number, count: number): Question[] {
  if (count <= 0 || questions.length === 0) return [];
  const n = Math.min(count, questions.length);

  const pool = questions.map((q) => {
    const s = stats[String(q.id)];
    const p = s && s.correct + s.wrong > 0 ? s.correct / (s.correct + s.wrong) : 0.5;
    return { q, w: Math.max(0.05, p * (1 - 2 * bias) + bias) };
  });

  const result: Question[] = [];
  while (result.length < n) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * total;
    let chosen = pool.length - 1;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) { chosen = i; break; } }
    result.push(pool[chosen].q);
    pool.splice(chosen, 1);
  }
  return result;
}

/**
 * Sample `count` questions with an exact seen/unseen proportion.
 *
 * unseenFraction = 0.0 → all seen questions
 *                 0.5 → 50 / 50 mix  (default "random")
 *                 1.0 → all unseen questions
 *
 * The proportion is satisfied as closely as the pool sizes allow; any shortfall
 * in one pool is filled from the other. Seen questions respect `bias`; unseen
 * questions are sampled uniformly (no answer history to weight by).
 */
export function weightedSample(
  questions: Question[],
  stats: Stats,
  bias: number,
  unseenFraction: number,
  count: number,
): Question[] {
  if (unseenFraction === 0.5 && bias === 0.5) {
    // Plain shuffle — no weighting needed
    return shuffle([...questions]).slice(0, count);
  }

  const seen   = questions.filter((q) =>  isSeen(q, stats));
  const unseen = questions.filter((q) => !isSeen(q, stats));

  // Ideal counts
  let wantUnseen = Math.round(count * unseenFraction);
  let wantSeen   = count - wantUnseen;

  // Cap to available pool sizes
  let getUnseen = Math.min(wantUnseen, unseen.length);
  let getSeen   = Math.min(wantSeen,   seen.length);

  // Redistribute any shortfall from the other pool
  const shortfall = count - getUnseen - getSeen;
  if (shortfall > 0) {
    getUnseen += Math.min(shortfall, unseen.length - getUnseen);
    getSeen   += Math.min(count - getUnseen - getSeen, seen.length - getSeen);
  }

  const seenSample   = bias !== 0.5
    ? biasWeightedSample(seen, stats, bias, getSeen)
    : shuffle([...seen]).slice(0, getSeen);
  const unseenSample = shuffle([...unseen]).slice(0, getUnseen);

  return shuffle([...seenSample, ...unseenSample]);
}
