import { X, RotateCcw } from 'lucide-react';
import type { Question, QuestionStat } from '../types';

export type QuestionStatus = 'unanswered' | 'answered' | 'correct' | 'wrong' | 'flagged';

interface Props {
  questions: Question[];
  currentIdx: number;
  getStatus: (idx: number) => QuestionStatus;
  getStats?: (qId: number) => QuestionStat | undefined;
  onResetStat?: (qId: number) => void;
  onNavigate: (idx: number) => void;
  onClose: () => void;
}

const STATUS_STYLES: Record<QuestionStatus, string> = {
  unanswered: 'bg-slate-700 border-slate-600 text-slate-400',
  answered:   'bg-blue-500/30 border-blue-500/40 text-blue-300',
  correct:    'bg-emerald-500/30 border-emerald-500/40 text-emerald-300',
  wrong:      'bg-rose-500/30 border-rose-500/40 text-rose-300',
  flagged:    'bg-amber-500/30 border-amber-500/50 text-amber-300',
};

const LEGEND: { status: QuestionStatus; label: string }[] = [
  { status: 'unanswered', label: 'Unanswered' },
  { status: 'answered',   label: 'Answered' },
  { status: 'correct',    label: 'Correct' },
  { status: 'wrong',      label: 'Wrong' },
  { status: 'flagged',    label: 'Flagged' },
];

export default function SummaryModal({ questions, currentIdx, getStatus, getStats, onResetStat, onNavigate, onClose }: Props) {
  // Only show legend entries that are actually present
  const presentStatuses = new Set(questions.map((_, i) => getStatus(i)));
  const legend = LEGEND.filter((l) => presentStatuses.has(l.status));

  const showStats = !!getStats;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-lg max-h-[80vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-700/50 shrink-0">
          <h2 className="text-base font-semibold">Summary</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
        </div>

        {/* Grid */}
        <div className="overflow-y-auto px-5 py-4 flex-1">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }}>
            {questions.map((q, i) => {
              const status = getStatus(i);
              const stat = getStats?.(q.id);
              const isCurrent = i === currentIdx;
              const hasLifetimeData = stat && (stat.correct + stat.wrong) > 0;

              return (
                <button
                  key={i}
                  onClick={() => { onNavigate(i); onClose(); }}
                  title={`Q${i + 1}: ${status}${hasLifetimeData ? ` · ${stat!.correct}✓ ${stat!.wrong}✗ lifetime` : ''}`}
                  className={`flex flex-col items-center justify-center rounded-xl border px-1 py-1.5 transition-all
                    ${STATUS_STYLES[status]}
                    ${isCurrent ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-800' : 'hover:opacity-80'}`}
                  style={{ minHeight: showStats ? '52px' : '40px' }}
                >
                  <span className="text-xs font-bold tabular-nums leading-none">{i + 1}</span>
                  {hasLifetimeData && (
                    <span className="text-[9px] leading-none mt-0.5 opacity-70 tabular-nums">
                      {stat!.correct}✓{stat!.wrong}✗
                    </span>
                  )}
                  {showStats && !hasLifetimeData && (
                    <span className="text-[9px] leading-none mt-0.5 opacity-30">–</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer: legend + optional reset */}
        <div className="px-5 py-3 border-t border-slate-700/50 shrink-0 space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {legend.map(({ status, label }) => (
              <span key={status} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className={`w-2.5 h-2.5 rounded border inline-block ${STATUS_STYLES[status]}`} />
                {label}
              </span>
            ))}
            {showStats && (
              <span className="text-xs text-slate-500 ml-auto">
                Lifetime stats shown in cells
              </span>
            )}
          </div>

          {onResetStat && (
            <button
              onClick={() => {
                questions.forEach((q) => onResetStat(q.id));
              }}
              className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset lifetime stats for these questions
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
