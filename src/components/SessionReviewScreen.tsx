import { useState, useCallback } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, StickyNote, LayoutList, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { SessionRecord } from '../types';
import { isAnswerCorrect } from '../utils/scoring';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { formatSeconds } from '../hooks/useTimer';
import SummaryModal from './SummaryModal';
import type { QuestionStatus } from './SummaryModal';
import ReactMarkdown from 'react-markdown';

interface Props {
  record: SessionRecord;
  onBack: () => void;
}

const MODE_LABEL: Record<string, string> = { exam: 'Exam', practice: 'Practice', flashcard: 'Flashcard' };

export default function SessionReviewScreen({ record, onBack }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [notes] = useLocalStorage<Record<string, string>>('quizzer_notes', {});

  const { questions, answers, config, timeElapsed, correctCount, mode, date } = record;
  const q = questions[currentIdx];
  const selected = answers[currentIdx] ?? [];
  const noteText = notes[String(q.id)] ?? '';
  const sessionCorrect = isAnswerCorrect(q, selected);

  const getStatus = useCallback((idx: number): QuestionStatus => {
    if (!(idx in answers) || (answers[idx] ?? []).length === 0) return 'unanswered';
    return isAnswerCorrect(questions[idx], answers[idx] ?? []) ? 'correct' : 'wrong';
  }, [answers, questions]);

  function getOptionClass(i: number): string {
    const opt = q.options[i];
    const isSelected = selected.includes(i);
    if (opt.correct) return 'bg-emerald-500/20 border-emerald-500 text-emerald-200';
    if (isSelected) return 'bg-rose-500/20 border-rose-500 text-rose-200';
    return 'bg-slate-800/40 border-slate-700/50 text-slate-500';
  }

  const pct = Math.round((correctCount / questions.length) * 100);
  const passed = pct >= config.passingScore;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 glass border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-2"><ArrowLeft className="w-5 h-5" /></button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-slate-300">{MODE_LABEL[mode]}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${passed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                {correctCount}/{questions.length} · {pct}%
              </span>
              <span className="text-xs text-slate-500 hidden sm:inline">{formatSeconds(timeElapsed)}</span>
            </div>
            <p className="text-xs text-slate-500 truncate">
              {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))}
            </p>
          </div>

          <span className="text-sm text-slate-400 tabular-nums font-medium shrink-0">{currentIdx + 1}/{questions.length}</span>

          <button onClick={() => setShowSummary(true)} className="btn-ghost p-2" title="Summary">
            <LayoutList className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col items-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-3xl space-y-5 animate-slide-up" key={currentIdx}>
          {/* Result banner */}
          {(answers[currentIdx] ?? []).length > 0 ? (
            sessionCorrect ? (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span className="font-semibold">Correct</span>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300">
                <XCircle className="w-5 h-5 shrink-0" />
                <span className="font-semibold">Incorrect</span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-700/30 border border-slate-700/50 text-slate-400 text-sm">
              Not answered
            </div>
          )}

          <div className="card p-6 sm:p-8">
            {q.selectCount > 1 && (
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">Select {q.selectCount} answers</p>
            )}
            <p className="text-slate-100 text-base sm:text-lg leading-relaxed">{q.text}</p>
          </div>

          <div className="space-y-2.5">
            {q.options.map((opt, i) => (
              <div
                key={i}
                className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-150 ${getOptionClass(i)}`}
              >
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded mr-3 text-xs font-bold shrink-0
                  ${opt.correct ? 'bg-emerald-500 text-white' :
                    selected.includes(i) ? 'bg-rose-500 text-white' :
                    'bg-slate-700 text-slate-400'}`}>
                  {String.fromCharCode(65 + i)}
                </span>
                {opt.text}
              </div>
            ))}
          </div>

          {/* Notes (read-only view) */}
          {noteText && (
            <div className="card overflow-hidden">
              <button
                onClick={() => setNotesOpen((v) => !v)}
                className="w-full flex items-center gap-2.5 p-4 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                <StickyNote className="w-4 h-4" />
                <span className="flex-1 text-left font-medium">Notes (saved)</span>
                {notesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {notesOpen && (
                <div className="border-t border-slate-700/50 px-4 py-3 prose prose-invert prose-sm max-w-none text-slate-300">
                  <ReactMarkdown>{noteText}</ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="sticky bottom-0 glass border-t border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => { setCurrentIdx((i) => i - 1); setNotesOpen(false); }}
            disabled={currentIdx === 0}
            className="btn-secondary flex items-center gap-1.5 px-4"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <div className="flex-1" />
          <button
            onClick={() => { setCurrentIdx((i) => i + 1); setNotesOpen(false); }}
            disabled={currentIdx === questions.length - 1}
            className="btn-secondary flex items-center gap-1.5 px-4"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showSummary && (
        <SummaryModal
          questions={questions}
          currentIdx={currentIdx}
          getStatus={getStatus}
          onNavigate={(idx) => { setCurrentIdx(idx); setNotesOpen(false); }}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
