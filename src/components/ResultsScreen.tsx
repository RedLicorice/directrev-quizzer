import { useState } from 'react';
import { Home, RotateCcw, ChevronDown, ChevronUp, CheckCircle2, XCircle } from 'lucide-react';
import type { SessionResult } from '../types';
import { calculateScore, isAnswerCorrect } from '../utils/scoring';
import { formatSeconds } from '../hooks/useTimer';

interface Props {
  result: SessionResult;
  onHome: () => void;
  onRetry: (result: SessionResult) => void;
}

export default function ResultsScreen({ result, onHome, onRetry }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const { correct, total, percentage, passed } = calculateScore(result);
  const unanswered = result.questions.filter((_, i) => !result.answers[i]?.length).length;

  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-8 animate-fade-in">
      <div className="w-full max-w-2xl space-y-6 py-8">

        {/* Score card */}
        <div className={`card p-8 text-center relative overflow-hidden`}>
          <div className={`absolute inset-0 opacity-10 ${passed ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          <div className="relative">
            <div className={`text-7xl font-extrabold tracking-tight mb-1 ${passed ? 'text-emerald-400' : 'text-rose-400'}`}>
              {percentage}%
            </div>
            <div className={`text-xl font-bold mb-4 ${passed ? 'text-emerald-300' : 'text-rose-300'}`}>
              {passed ? '🎉 Passed!' : '❌ Not passed'}
            </div>

            <div className="flex justify-center gap-8 text-sm text-slate-400">
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-400">{correct}</div>
                <div>Correct</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-rose-400">{total - correct - unanswered}</div>
                <div>Incorrect</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-400">{unanswered}</div>
                <div>Unanswered</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-400">{formatSeconds(result.timeElapsed)}</div>
                <div>Time</div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-5 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${passed ? 'bg-emerald-500' : 'bg-rose-500'}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>0%</span>
              <span>Pass: {result.config.passingScore}%</span>
              <span>100%</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={onHome} className="btn-secondary flex-1 flex items-center justify-center gap-2">
            <Home className="w-4 h-4" /> Home
          </button>
          <button onClick={() => onRetry(result)} className="btn-primary flex-1 flex items-center justify-center gap-2">
            <RotateCcw className="w-4 h-4" /> Try Again
          </button>
        </div>

        {/* Question review */}
        <div>
          <h2 className="text-lg font-semibold mb-3 text-slate-300">Question Review</h2>
          <div className="space-y-2">
            {result.questions.map((q, i) => {
              const selected = result.answers[i] ?? [];
              const correct = isAnswerCorrect(q, selected);
              const expanded = expandedIdx === i;

              return (
                <div key={q.id} className="card overflow-hidden">
                  <button
                    onClick={() => setExpandedIdx(expanded ? null : i)}
                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-700/30 transition-colors"
                  >
                    {correct ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <span className="flex-1 text-sm text-slate-300 leading-snug line-clamp-2">{q.text}</span>
                    {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 space-y-1.5 border-t border-slate-700/50 pt-3">
                      {q.options.map((opt, j) => {
                        const wasSelected = selected.includes(j);
                        let cls = 'text-slate-400 text-sm py-1.5 px-3 rounded-lg ';
                        if (opt.correct) cls += 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
                        else if (wasSelected && !opt.correct) cls += 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
                        else cls += 'text-slate-500';

                        return (
                          <div key={j} className={cls}>
                            {opt.correct ? '✓ ' : wasSelected ? '✗ ' : '  '}
                            {opt.text}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
