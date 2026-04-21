import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { Question } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';
import ReactMarkdown from 'react-markdown';

interface Props {
  questions: Question[];
  onExit: () => void;
}

export default function FlashcardSession({ questions, onExit }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [notes] = useLocalStorage<Record<string, string>>('quizzer_notes', {});

  const q = questions[currentIdx];
  const noteText = notes[String(q.id)] ?? '';

  useEffect(() => {
    setFlipped(false);
  }, [currentIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && currentIdx < questions.length - 1) {
        setCurrentIdx((i) => i + 1);
      } else if (e.key === 'ArrowLeft' && currentIdx > 0) {
        setCurrentIdx((i) => i - 1);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIdx, questions.length]);

  // Need enough height for all options; use min-h instead of fixed h
  const cardHeight = Math.max(360, 100 + q.options.length * 56);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="glass border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button onClick={onExit} className="btn-ghost p-2"><X className="w-5 h-5" /></button>
          <div className="flex-1 text-center text-sm text-slate-400 font-medium">
            Flashcards · {currentIdx + 1} / {questions.length}
          </div>
          <button
            onClick={() => setFlipped((f) => !f)}
            className="btn-ghost flex items-center gap-1.5 text-sm"
          >
            <RotateCcw className="w-4 h-4" /> Flip
          </button>
        </div>
      </div>

      <div className="h-1 bg-slate-800">
        <div
          className="h-full bg-amber-500 transition-all duration-300"
          style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6">
        <p className="text-xs text-slate-600">
          Click card or press Space to flip · ← → to navigate
        </p>

        <div
          className="flip-scene w-full max-w-2xl cursor-pointer"
          style={{ height: `${cardHeight}px` }}
          onClick={() => setFlipped((f) => !f)}
        >
          <div className={`flip-card w-full h-full ${flipped ? 'flipped' : ''}`}>
            {/* Front */}
            <div className="flip-face card flex flex-col items-center justify-center p-8 sm:p-12">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">Question</span>
              {q.selectCount > 1 && (
                <span className="text-xs font-semibold text-amber-400 mb-3">
                  Select {q.selectCount} answers
                </span>
              )}
              <p className="text-slate-100 text-base sm:text-xl text-center leading-relaxed font-medium">
                {q.text}
              </p>
            </div>

            {/* Back — all options with correct/wrong styling */}
            <div className="flip-face flip-face-back card flex flex-col p-5 sm:p-7 overflow-y-auto">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3 text-center shrink-0">
                Answers
              </span>

              <div className="space-y-2 shrink-0">
                {q.options.map((opt, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 rounded-xl px-4 py-2.5 text-sm border
                      ${opt.correct
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-700/30 border-slate-700/40 text-slate-500'
                      }`}
                  >
                    <span className={`mt-0.5 shrink-0 font-bold text-xs ${opt.correct ? 'text-emerald-400' : 'text-slate-600'}`}>
                      {opt.correct ? '✓' : '✗'}
                    </span>
                    <span>{opt.text}</span>
                  </div>
                ))}
              </div>

              {noteText && (
                <div className="mt-4 border-t border-slate-700/50 pt-4 shrink-0">
                  <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">My Notes</p>
                  <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                    <ReactMarkdown>{noteText}</ReactMarkdown>
                  </div>
                </div>
              )}

              {!noteText && (
                <p className="mt-auto pt-4 text-center text-xs text-slate-600">
                  No notes · add them in Practice mode
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => setCurrentIdx((i) => i - 1)}
            disabled={currentIdx === 0}
            className="btn-secondary flex items-center gap-2 px-5"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>

          <span className="text-slate-500 text-sm tabular-nums">{currentIdx + 1}/{questions.length}</span>

          {currentIdx < questions.length - 1 ? (
            <button
              onClick={() => setCurrentIdx((i) => i + 1)}
              className="btn-secondary flex items-center gap-2 px-5"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={onExit} className="btn-primary px-5">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
