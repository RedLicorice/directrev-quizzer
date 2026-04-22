import type { Question, Stats } from '../types';

/**
 * bias = 0.0 → weight by correct rate  (questions answered correctly get higher probability)
 * bias = 0.5 → uniform weights          (behaves like a normal shuffle)
 * bias = 1.0 → weight by wrong rate     (questions answered incorrectly get higher probability)
 *
 * Weight formula: w = p·(1 − 2·bias) + bias
 *   where p = correct/(correct+wrong), defaulting to 0.5 for unseen questions.
 * At bias=0.5 every question gets w=0.5, so all are equally likely.
 */
export function weightedSample(questions: Question[], stats: Stats, bias: number, count: number): Question[] {
  const weights = questions.map((q) => {
    const s = stats[String(q.id)];
    const p = s && s.correct + s.wrong > 0
      ? s.correct / (s.correct + s.wrong)
      : 0.5;
    return Math.max(0.05, p * (1 - 2 * bias) + bias);
  });

  // Weighted sampling without replacement
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
