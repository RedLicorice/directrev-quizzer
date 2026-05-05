import { useState, useMemo } from 'react';
import { ArrowLeft, RotateCcw, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { Question, Stats, QuestionStat } from '../types';

interface Props {
  questions: Question[];
  stats: Stats;
  onBack: () => void;
  onResetStat: (qId: number) => void;
  onResetAllStats: () => void;
}

type SortKey = 'id' | 'rate' | 'attempts';
type Filter = 'all' | 'weak' | 'strong' | 'unseen';

function getRate(stat: QuestionStat | undefined): number | null {
  if (!stat || stat.correct + stat.wrong === 0) return null;
  return stat.correct / (stat.correct + stat.wrong);
}

function RateBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-slate-600 text-xs">unseen</span>;
  const pct = Math.round(rate * 100);
  const color = rate >= 0.7 ? 'bg-emerald-500' : rate >= 0.4 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs tabular-nums font-medium ${rate >= 0.7 ? 'text-emerald-400' : rate >= 0.4 ? 'text-amber-400' : 'text-rose-400'}`}>
        {pct}%
      </span>
    </div>
  );
}

export default function DatasetScreen({ questions, stats, onBack, onResetStat, onResetAllStats }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmReset, setConfirmReset] = useState<number | 'all' | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const totalAttempted = useMemo(() => Object.keys(stats).length, [stats]);
  const totalWeak = useMemo(
    () => questions.filter((q) => { const r = getRate(stats[String(q.id)]); return r !== null && r < 0.6; }).length,
    [questions, stats],
  );
  const totalStrong = useMemo(
    () => questions.filter((q) => { const r = getRate(stats[String(q.id)]); return r !== null && r >= 0.7; }).length,
    [questions, stats],
  );

  const filtered = useMemo(() => {
    return questions.filter((q) => {
      const rate = getRate(stats[String(q.id)]);
      if (filter === 'unseen') return rate === null;
      if (filter === 'weak') return rate !== null && rate < 0.6;
      if (filter === 'strong') return rate !== null && rate >= 0.7;
      return true;
    });
  }, [questions, stats, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'id') cmp = a.id - b.id;
      else if (sortKey === 'attempts') {
        const sa = stats[String(a.id)];
        const sb = stats[String(b.id)];
        cmp = ((sa?.correct ?? 0) + (sa?.wrong ?? 0)) - ((sb?.correct ?? 0) + (sb?.wrong ?? 0));
      } else if (sortKey === 'rate') {
        const ra = getRate(stats[String(a.id)]) ?? -1;
        const rb = getRate(stats[String(b.id)]) ?? -1;
        cmp = ra - rb;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortAsc, stats]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === 'rate'); } // weakest first by default
    setPage(0);
  }

  const pages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function SortBtn({ k, label }: { k: SortKey; label: string }) {
    const active = sortKey === k;
    return (
      <button
        onClick={() => handleSort(k)}
        className={`text-xs font-semibold uppercase tracking-wider transition-colors ${active ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
      >
        {label} {active ? (sortAsc ? '↑' : '↓') : ''}
      </button>
    );
  }

  return (
    <div className="min-h-screen flex flex-col animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 z-10 glass border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-2"><ArrowLeft className="w-5 h-5" /></button>
          <h1 className="text-base font-semibold">Dataset</h1>
          <span className="text-slate-500 text-sm">· {questions.length} questions</span>
          <div className="flex-1" />
          {totalAttempted > 0 && (
            <button
              onClick={() => setConfirmReset('all')}
              className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset all stats
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-slate-100">{totalAttempted}</p>
              <p className="text-xs text-slate-500 mt-0.5">Attempted</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{totalStrong}</p>
              <p className="text-xs text-slate-500 mt-0.5">Strong (≥70%)</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-rose-400">{totalWeak}</p>
              <p className="text-xs text-slate-500 mt-0.5">Weak (&lt;60%)</p>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {(['all', 'weak', 'strong', 'unseen'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize
                  ${filter === f ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                {f === 'all' ? `All (${questions.length})` :
                 f === 'weak' ? `Weak (${totalWeak})` :
                 f === 'strong' ? `Strong (${totalStrong})` :
                 `Unseen (${questions.length - totalAttempted})`}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[3rem_1fr_5rem_5rem_6rem_2.5rem] gap-2 px-4 py-2.5 border-b border-slate-700/50 items-center">
              <SortBtn k="id" label="#" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Question</span>
              <SortBtn k="attempts" label="Tries" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">✓/✗</span>
              <SortBtn k="rate" label="Rate" />
              <span />
            </div>

            {pageItems.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">No questions match this filter.</div>
            ) : (
              <div className="divide-y divide-slate-700/30">
                {pageItems.map((q) => {
                  const stat = stats[String(q.id)];
                  const rate = getRate(stat);
                  const attempts = (stat?.correct ?? 0) + (stat?.wrong ?? 0);
                  return (
                    <div key={q.id} className="grid grid-cols-[3rem_1fr_5rem_5rem_6rem_2.5rem] gap-2 px-4 py-3 items-center hover:bg-slate-800/30 transition-colors">
                      <span className="text-xs text-slate-500 tabular-nums font-medium">{q.id}</span>
                      <p className="text-sm text-slate-300 leading-snug line-clamp-2 min-w-0">{q.text}</p>
                      <span className="text-xs text-slate-400 tabular-nums text-center">{attempts || '–'}</span>
                      <span className="text-xs tabular-nums text-right">
                        {stat ? (
                          <span className="flex items-center justify-end gap-1">
                            <span className="text-emerald-400">{stat.correct}</span>
                            <span className="text-slate-600">/</span>
                            <span className="text-rose-400">{stat.wrong}</span>
                          </span>
                        ) : <span className="text-slate-600">–</span>}
                      </span>
                      <RateBar rate={rate} />
                      <div className="flex justify-end">
                        {stat && attempts > 0 && (
                          <button
                            onClick={() => setConfirmReset(q.id)}
                            title="Reset stats for this question"
                            className="p-1 text-slate-600 hover:text-rose-400 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-40">←</button>
              <span className="text-sm text-slate-400">{page + 1} / {pages}</span>
              <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page === pages - 1} className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-40">→</button>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-400" /> Strong ≥70%</span>
            <span className="flex items-center gap-1"><Minus className="w-3 h-3 text-amber-400" /> Mixed 40–70%</span>
            <span className="flex items-center gap-1"><TrendingDown className="w-3 h-3 text-rose-400" /> Weak &lt;40%</span>
          </div>
        </div>
      </div>

      {/* Confirm reset modal */}
      {confirmReset !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-sm p-6 animate-slide-up">
            <h2 className="text-base font-semibold mb-2">Reset Stats?</h2>
            <p className="text-slate-400 text-sm mb-6">
              {confirmReset === 'all'
                ? 'Reset answer history for all questions? This cannot be undone.'
                : 'Reset answer history for this question? This cannot be undone.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmReset(null)} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={() => {
                  if (confirmReset === 'all') onResetAllStats();
                  else onResetStat(confirmReset as number);
                  setConfirmReset(null);
                }}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-semibold transition-colors text-sm"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
