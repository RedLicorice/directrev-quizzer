import { useState, useCallback } from 'react';
import { Flag, ChevronLeft, ChevronRight, Grid3X3, X, Send } from 'lucide-react';
import type { Question, SessionConfig, SessionResult } from '../types';
import { useTimer, formatSeconds } from '../hooks/useTimer';

interface Props {
  questions: Question[];
  config: SessionConfig;
  onFinish: (result: SessionResult) => void;
  onExit: () => void;
}

export default function ExamSession({ questions, config, onFinish, onExit }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [showOverview, setShowOverview] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [startTime] = useState(Date.now);

  const totalSeconds = config.timeLimit * 60;
  const { remaining } = useTimer(totalSeconds, () => handleSubmit());

  const q = questions[currentIdx];
  const selected = answers[currentIdx] ?? [];
  const answered = Object.keys(answers).filter((k) => answers[Number(k)].length > 0).length;

  const toggleOption = useCallback(
    (optIdx: number) => {
      setAnswers((prev) => {
        const cur = prev[currentIdx] ?? [];
        if (q.selectCount === 1) {
          return { ...prev, [currentIdx]: [optIdx] };
        }
        const next = cur.includes(optIdx) ? cur.filter((i) => i !== optIdx) : [...cur, optIdx];
        return { ...prev, [currentIdx]: next };
      });
    },
    [currentIdx, q.selectCount],
  );

  const toggleFlag = useCallback(() => {
    setFlagged((f) => {
      const s = new Set(f);
      s.has(currentIdx) ? s.delete(currentIdx) : s.add(currentIdx);
      return s;
    });
  }, [currentIdx]);

  function handleSubmit() {
    onFinish({
      mode: 'exam',
      questions,
      answers,
      config,
      timeElapsed: Math.round((Date.now() - startTime) / 1000),
    });
  }

  const unanswered = questions.length - answered;

  // Timer color
  const timerColor = remaining === null
    ? 'text-slate-300'
    : remaining < 300 ? 'text-rose-400 animate-pulse-slow'
    : remaining < 600 ? 'text-amber-400'
    : 'text-slate-300';

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 glass border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button onClick={() => setShowExitConfirm(true)} className="btn-ghost p-2">
            <X className="w-5 h-5" />
          </button>

          {/* Progress */}
          <div className="flex-1">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>{answered} answered</span>
              <span>{questions.length - answered} remaining</span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all"
                style={{ width: `${(answered / questions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Timer */}
          {config.timeLimit > 0 && remaining !== null && (
            <div className={`font-mono font-semibold text-sm tabular-nums ${timerColor}`}>
              {formatSeconds(remaining)}
            </div>
          )}

          {/* Q counter */}
          <span className="text-sm text-slate-400 font-medium tabular-nums">
            {currentIdx + 1}/{questions.length}
          </span>

          {/* Overview */}
          <button onClick={() => setShowOverview(true)} className="btn-ghost p-2">
            <Grid3X3 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col items-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-3xl space-y-5 animate-slide-up" key={currentIdx}>
          <div className="card p-6 sm:p-8">
            {q.selectCount > 1 && (
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">
                Select {q.selectCount} answers
              </p>
            )}
            <p className="text-slate-100 text-base sm:text-lg leading-relaxed">{q.text}</p>
          </div>

          <div className="space-y-2.5">
            {q.options.map((opt, i) => {
              const isSelected = selected.includes(i);
              return (
                <button
                  key={i}
                  onClick={() => toggleOption(i)}
                  className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-150
                    ${isSelected
                      ? 'bg-blue-500/20 border-blue-500 text-blue-200'
                      : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-700/40'
                    }`}
                >
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded mr-3 text-xs font-bold shrink-0
                    ${isSelected ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  {opt.text}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 glass border-t border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => setCurrentIdx((i) => i - 1)}
            disabled={currentIdx === 0}
            className="btn-secondary flex items-center gap-1.5 px-4"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>

          <button
            onClick={toggleFlag}
            className={`btn-ghost flex items-center gap-1.5 px-4 ${flagged.has(currentIdx) ? 'text-amber-400' : ''}`}
          >
            <Flag className="w-4 h-4" />
            {flagged.has(currentIdx) ? 'Flagged' : 'Flag'}
          </button>

          <div className="flex-1" />

          {currentIdx < questions.length - 1 ? (
            <button
              onClick={() => setCurrentIdx((i) => i + 1)}
              className="btn-secondary flex items-center gap-1.5 px-4"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => setShowSubmitConfirm(true)}
              className="btn-primary flex items-center gap-2 px-5"
            >
              <Send className="w-4 h-4" /> Submit
            </button>
          )}
        </div>
      </div>

      {/* Overview modal */}
      {showOverview && (
        <Modal title="Question Overview" onClose={() => setShowOverview(false)}>
          <div className="grid grid-cols-8 gap-2 mb-4">
            {questions.map((_, i) => {
              const isAnswered = (answers[i] ?? []).length > 0;
              const isFlagged = flagged.has(i);
              const isCurrent = i === currentIdx;
              return (
                <button
                  key={i}
                  onClick={() => { setCurrentIdx(i); setShowOverview(false); }}
                  className={`aspect-square rounded-lg text-xs font-bold transition-all
                    ${isCurrent ? 'ring-2 ring-amber-400' : ''}
                    ${isFlagged ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50' :
                      isAnswered ? 'bg-blue-500/30 text-blue-300 border border-blue-500/30' :
                      'bg-slate-700 text-slate-400 border border-slate-600'}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="flex gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500/40 border border-blue-500/50 inline-block" /> Answered</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-700 border border-slate-600 inline-block" /> Unanswered</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500/50 inline-block" /> Flagged</span>
          </div>
        </Modal>
      )}

      {/* Submit confirm */}
      {showSubmitConfirm && (
        <Modal title="Submit Exam?" onClose={() => setShowSubmitConfirm(false)}>
          {unanswered > 0 && (
            <p className="text-amber-400 text-sm mb-4">
              ⚠️ You have {unanswered} unanswered question{unanswered > 1 ? 's' : ''}.
            </p>
          )}
          <p className="text-slate-400 text-sm mb-6">Once submitted, you cannot change your answers.</p>
          <div className="flex gap-3">
            <button onClick={() => setShowSubmitConfirm(false)} className="btn-secondary flex-1">Cancel</button>
            <button onClick={handleSubmit} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Send className="w-4 h-4" /> Submit
            </button>
          </div>
        </Modal>
      )}

      {/* Exit confirm */}
      {showExitConfirm && (
        <Modal title="Exit Exam?" onClose={() => setShowExitConfirm(false)}>
          <p className="text-slate-400 text-sm mb-6">Your progress will be lost.</p>
          <div className="flex gap-3">
            <button onClick={() => setShowExitConfirm(false)} className="btn-secondary flex-1">Continue Exam</button>
            <button onClick={onExit} className="btn-primary flex-1">Exit</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-md p-6 animate-slide-up">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
