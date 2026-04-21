import { useState, useCallback } from 'react';
import { X, ChevronRight, StickyNote, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { Question, SessionConfig, SessionResult } from '../types';
import { isAnswerCorrect } from '../utils/scoring';
import { useLocalStorage } from '../hooks/useLocalStorage';
import ReactMarkdown from 'react-markdown';

interface Props {
  questions: Question[];
  config: SessionConfig;
  onFinish: (result: SessionResult) => void;
  onExit: () => void;
}

export default function PracticeSession({ questions, config, onFinish, onExit }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useLocalStorage<Record<string, string>>('quizzer_notes', {});
  const [startTime] = useState(Date.now);

  const q = questions[currentIdx];
  const selected = answers[currentIdx] ?? [];
  const isRevealed = revealed.has(currentIdx);
  const noteText = notes[String(q.id)] ?? '';

  const correct = Object.keys(answers).filter((k) => {
    const idx = Number(k);
    return revealed.has(idx) && isAnswerCorrect(questions[idx], answers[idx]);
  }).length;
  const wrong = Object.keys(answers).filter((k) => {
    const idx = Number(k);
    return revealed.has(idx) && !isAnswerCorrect(questions[idx], answers[idx]);
  }).length;

  const toggleOption = useCallback(
    (optIdx: number) => {
      if (isRevealed) return;
      setAnswers((prev) => {
        const cur = prev[currentIdx] ?? [];
        if (q.selectCount === 1) return { ...prev, [currentIdx]: [optIdx] };
        const next = cur.includes(optIdx) ? cur.filter((i) => i !== optIdx) : [...cur, optIdx];
        return { ...prev, [currentIdx]: next };
      });
    },
    [currentIdx, q.selectCount, isRevealed],
  );

  function handleCheck() {
    if (!selected.length) return;
    setRevealed((r) => new Set([...r, currentIdx]));
  }

  function handleNext() {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx((i) => i + 1);
      setNotesOpen(false);
    } else {
      handleFinish();
    }
  }

  function handleFinish() {
    onFinish({
      mode: 'practice',
      questions,
      answers,
      config,
      timeElapsed: Math.round((Date.now() - startTime) / 1000),
    });
  }

  function getOptionClass(i: number): string {
    const isSelected = selected.includes(i);
    const opt = q.options[i];
    if (!isRevealed) {
      return isSelected
        ? 'bg-blue-500/20 border-blue-500 text-blue-200'
        : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-700/40';
    }
    if (opt.correct) return 'bg-emerald-500/20 border-emerald-500 text-emerald-200';
    if (isSelected && !opt.correct) return 'bg-rose-500/20 border-rose-500 text-rose-200';
    return 'bg-slate-800/40 border-slate-700/50 text-slate-500';
  }

  const questionCorrect = isRevealed && isAnswerCorrect(q, selected);
  const questionWrong = isRevealed && !isAnswerCorrect(q, selected);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 glass border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button onClick={onExit} className="btn-ghost p-2"><X className="w-5 h-5" /></button>

          {/* Live score */}
          <div className="flex gap-3 text-sm font-semibold">
            <span className="text-emerald-400">{correct} ✓</span>
            <span className="text-rose-400">{wrong} ✗</span>
            <span className="text-slate-500">{revealed.size - correct - wrong > 0 ? `${revealed.size - correct - wrong} skip` : ''}</span>
          </div>

          {/* Progress */}
          <div className="flex-1">
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all"
                style={{ width: `${(revealed.size / questions.length) * 100}%` }}
              />
            </div>
          </div>

          <span className="text-sm text-slate-400 tabular-nums font-medium">
            {currentIdx + 1}/{questions.length}
          </span>

          <button onClick={handleFinish} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Finish
          </button>
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col items-center px-4 py-6 sm:py-10 space-y-5">
        <div className="w-full max-w-3xl space-y-5 animate-slide-up" key={currentIdx}>
          {/* Feedback banner */}
          {questionCorrect && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 animate-fade-in">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="font-semibold">Correct!</span>
            </div>
          )}
          {questionWrong && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 animate-fade-in">
              <XCircle className="w-5 h-5 shrink-0" />
              <span className="font-semibold">Incorrect</span>
            </div>
          )}

          <div className="card p-6 sm:p-8">
            {q.selectCount > 1 && (
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">
                Select {q.selectCount} answers
              </p>
            )}
            <p className="text-slate-100 text-base sm:text-lg leading-relaxed">{q.text}</p>
          </div>

          {/* Options */}
          <div className="space-y-2.5">
            {q.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => toggleOption(i)}
                disabled={isRevealed}
                className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-150 ${getOptionClass(i)}`}
              >
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded mr-3 text-xs font-bold shrink-0
                  ${selected.includes(i) && !isRevealed ? 'bg-blue-500 text-white' :
                    opt.correct && isRevealed ? 'bg-emerald-500 text-white' :
                    selected.includes(i) && isRevealed && !opt.correct ? 'bg-rose-500 text-white' :
                    'bg-slate-700 text-slate-400'}`}>
                  {String.fromCharCode(65 + i)}
                </span>
                {opt.text}
              </button>
            ))}
          </div>

          {/* Notes editor */}
          <div className="card overflow-hidden">
            <button
              onClick={() => setNotesOpen((v) => !v)}
              className="w-full flex items-center gap-2.5 p-4 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              <StickyNote className="w-4 h-4" />
              <span className="flex-1 text-left font-medium">
                Notes {noteText ? '(saved)' : ''}
              </span>
              {notesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {notesOpen && (
              <div className="border-t border-slate-700/50">
                <textarea
                  placeholder="Write your notes in markdown…"
                  value={noteText}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, [String(q.id)]: e.target.value }))
                  }
                  rows={5}
                  className="w-full bg-slate-900/50 px-4 py-3 text-sm text-slate-200 placeholder-slate-600
                    focus:outline-none resize-none font-mono"
                />
                {noteText && (
                  <div className="border-t border-slate-700/50 px-4 py-3 prose prose-invert prose-sm max-w-none text-slate-300">
                    <ReactMarkdown>{noteText}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 glass border-t border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex justify-end gap-3">
          {!isRevealed ? (
            <button
              onClick={handleCheck}
              disabled={!selected.length}
              className="btn-primary flex items-center gap-2 px-6"
            >
              Check Answer
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="btn-primary flex items-center gap-2 px-6"
            >
              {currentIdx < questions.length - 1 ? (
                <>Next <ChevronRight className="w-4 h-4" /></>
              ) : (
                'Finish'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
