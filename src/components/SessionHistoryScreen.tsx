import { useState, useMemo } from 'react';
import { ArrowLeft, Clock, BookOpen, Layers, Trash2, ChevronRight } from 'lucide-react';
import type { SessionRecord } from '../types';
import { formatSeconds } from '../hooks/useTimer';

interface Props {
  sessionsKey: string;
  onBack: () => void;
  onOpen: (record: SessionRecord) => void;
  onClearHistory: () => void;
}

function loadSessions(key: string): SessionRecord[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SessionRecord[]) : [];
  } catch { return []; }
}

const MODE_META = {
  exam:      { label: 'Exam',      icon: Clock,     color: 'text-rose-400',    bg: 'bg-rose-500/10 border-rose-500/20' },
  practice:  { label: 'Practice',  icon: BookOpen,  color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  flashcard: { label: 'Flashcard', icon: Layers,    color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20' },
};

function ScoreBadge({ correct, total, passing }: { correct: number; total: number; passing: number }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const passed = pct >= passing;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${passed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
      {correct}/{total} · {pct}%
    </span>
  );
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch { return iso; }
}

export default function SessionHistoryScreen({ sessionsKey, onBack, onOpen, onClearHistory }: Props) {
  const [records, setRecords] = useState<SessionRecord[]>(() => loadSessions(sessionsKey));
  const [confirmClear, setConfirmClear] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, SessionRecord[]>();
    for (const r of records) {
      const day = r.date.slice(0, 10);
      const arr = map.get(day) ?? [];
      arr.push(r);
      map.set(day, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  function handleClear() {
    onClearHistory();
    setRecords([]);
    setConfirmClear(false);
  }

  return (
    <div className="min-h-screen flex flex-col animate-slide-up">
      <div className="sticky top-0 z-10 glass border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-2"><ArrowLeft className="w-5 h-5" /></button>
          <h1 className="flex-1 text-base font-semibold">Session History</h1>
          {records.length > 0 && (
            !confirmClear ? (
              <button onClick={() => setConfirmClear(true)} className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Clear all
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-300">Sure?</span>
                <button onClick={handleClear} className="text-xs bg-rose-500 hover:bg-rose-400 text-white px-2 py-1 rounded-lg">Yes</button>
                <button onClick={() => setConfirmClear(false)} className="text-xs text-slate-400 hover:text-slate-200">No</button>
              </div>
            )
          )}
        </div>
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 space-y-8">
        {records.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No sessions recorded yet.</p>
            <p className="text-xs mt-1">Complete an Exam or Practice session to see it here.</p>
          </div>
        ) : (
          grouped.map(([day, recs]) => (
            <div key={day}>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
                {new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date(day))}
              </p>
              <div className="space-y-2">
                {recs.map((r) => {
                  const meta = MODE_META[r.mode];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={r.id}
                      onClick={() => onOpen(r)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-700/50 bg-slate-800/40
                        hover:border-slate-600 hover:bg-slate-700/40 transition-all text-left"
                    >
                      <div className={`flex-shrink-0 w-9 h-9 rounded-xl border flex items-center justify-center ${meta.bg}`}>
                        <Icon className={`w-4 h-4 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
                          <ScoreBadge correct={r.correctCount} total={r.questions.length} passing={r.config.passingScore} />
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                          <span>{formatDate(r.date)}</span>
                          <span>·</span>
                          <span>{formatSeconds(r.timeElapsed)}</span>
                          <span>·</span>
                          <span>{r.questions.length} questions</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
