import type { Question, Stats } from '../types';

/**
 * bias     = 0.0 → favour mastered (high correct rate gets higher weight)
 *            0.5 → uniform (no effect)
 *            1.0 → favour struggling (high wrong rate gets higher weight)
 *
 * seenBias = 0.0 → seen only   (questions with any stats get ~100× the weight of unseen)
 *            0.5 → mixed       (no effect on seen/unseen balance)
 *            1.0 → unseen only (unseen questions get ~100× the weight of seen)
 *
 * Combined weight = biasWeight × seenWeight, floored at 0.001.
 */
export function weightedSample(
  questions: Question[],
  stats: Stats,
  bias: number,
  seenBias: number,
  count: number,
): Question[] {
  const weights = questions.map((q) => {
    const s = stats[String(q.id)];
    const isSeen = Boolean(s && s.correct + s.wrong > 0);
    const p = isSeen ? s!.correct / (s!.correct + s!.wrong) : 0.5;

    // Correct/wrong bias weight
    const biasW = Math.max(0.05, p * (1 - 2 * bias) + bias);

    // Seen/unseen weight: at 0.5 → 1.0 (no effect); at 0 → seen=2, unseen=0.01; at 1 → unseen=2, seen=0.01
    let seenW = 1.0;
    if (seenBias !== 0.5) {
      const wUnseen = Math.max(0.01, 2 * seenBias);
      const wSeen   = Math.max(0.01, 2 * (1 - seenBias));
      seenW = isSeen ? wSeen : wUnseen;
    }

    return Math.max(0.001, biasW * seenW);
  });

  const pool = questions.map((q, i) => ({ q, w: weights[i] }));
  const result: Question[] = [];

  while (result.length < Math.min(count, pool.length)) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * total;
    let chosen = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) { chosen = i; break; }
    }
    result.push(pool[chosen].q);
    pool.splice(chosen, 1);
  }

  return result;
}
