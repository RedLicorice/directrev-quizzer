import { useState, useCallback, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, StickyNote, CheckCircle2, XCircle, ChevronDown, ChevronUp, LayoutList, Pause, Play, Download } from 'lucide-react';
import type { Question, SessionConfig, SessionResult, Stats, PracticeSessionDraft, PracticeSessionExport } from '../types';
import { isAnswerCorrect } from '../utils/scoring';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { STATS_KEY, PRACTICE_DRAFT_KEY } from '../App';
import SummaryModal from './SummaryModal';
import type { QuestionStatus } from './SummaryModal';
import ReactMarkdown from 'react-markdown';
import { QuestionMarkdown, InlineText } from './MarkdownText';

interface Props {
  questions: Question[];
  config: SessionConfig;
  initialDraft?: PracticeSessionDraft;
  onFinish: (result: SessionResult) => void;
  onExit: () => void;
}

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function QuestionImage({ src }: { src: string }) {
  return (
    <div className="mt-4">
      <img src={src} alt="Question diagram" className="max-w-full rounded-lg border border-slate-700/50 mx-auto block" style={{ maxHeight: '400px' }} />
    </div>
  );
}

export default function PracticeSession({ questions, config, initialDraft, onFinish, onExit }: Props) {
  const [currentIdx, setCurrentIdx] = useState(() => initialDraft?.currentIdx ?? 0);
  const [answers, setAnswers] = useState<Record<number, number[]>>(() => initialDraft?.answers ?? {});
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set(initialDraft?.revealed ?? []));
  const [notesOpen, setNotesOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [notes, setNotes] = useLocalStorage<Record<string, string>>('quizzer_notes', {});
  const [stats, setStats] = useLocalStorage<Stats>(STATS_KEY, {});
  const [startTime] = useState(() => initialDraft?.startTime ?? Date.now());
  const draftIdRef = useRef(initialDraft?.id ?? String(Date.now()));

  const q = questions[currentIdx];
  const selected = answers[currentIdx] ?? [];
  const isRevealed = revealed.has(currentIdx);
  const noteText = notes[String(q.id)] ?? '';

  const correct = Array.from(revealed).filter((idx) => isAnswerCorrect(questions[idx], answers[idx] ?? [])).length;
  const wrong = revealed.size - correct;

  // Auto-save draft whenever answer state changes
  useEffect(() => {
    if (revealed.size === 0 && Object.keys(answers).length === 0) return;
    const draft: PracticeSessionDraft = {
      id: draftIdRef.current,
      savedAt: new Date().toISOString(),
      questionIds: questions.map((q) => q.id),
      config,
      currentIdx,
      answers,
      revealed: Array.from(revealed),
      startTime,
    };
    localStorage.setItem(PRACTICE_DRAFT_KEY, JSON.stringify(draft));
  }, [answers, revealed, currentIdx, questions, config, startTime]);

  const toggleOption = useCallback(
    (optIdx: number) => {
      if (isRevealed) return;
      setAnswers((prev) => {
        const cur = prev[currentIdx] ?? [];
        if (q.selectCount === 1) return { ...prev, [currentIdx]: [optIdx] };
        const isSelected = cur.includes(optIdx);
        // Don't allow selecting more than the required count
        if (!isSelected && cur.length >= q.selectCount) return prev;
        const next = isSelected ? cur.filter((i) => i !== optIdx) : [...cur, optIdx];
        return { ...prev, [currentIdx]: next };
      });
    },
    [currentIdx, q.selectCount, isRevealed],
  );

  function handleCheck() {
    if (!selected.length) return;
    const wasCorrect = isAnswerCorrect(q, selected);
    setRevealed((r) => new Set([...r, currentIdx]));
    setStats((s) => {
      const key = String(q.id);
      const prev = s[key] ?? { correct: 0, wrong: 0 };
      return { ...s, [key]: { correct: prev.correct + (wasCorrect ? 1 : 0), wrong: prev.wrong + (wasCorrect ? 0 : 1) } };
    });
  }

  function navigate(idx: number) {
    setCurrentIdx(idx);
    setNotesOpen(false);
  }

  function handleNext() {
    if (currentIdx < questions.length - 1) navigate(currentIdx + 1);
    else handleFinish();
  }

  function handlePrev() {
    if (currentIdx > 0) navigate(currentIdx - 1);
  }

  function handleFinish() {
    localStorage.removeItem(PRACTICE_DRAFT_KEY);
    onFinish({ mode: 'practice', questions, answers, config, timeElapsed: Math.round((Date.now() - startTime) / 1000) });
  }

  function handleExportSession() {
    const exp: PracticeSessionExport = {
      version: 1,
      type: 'practice-session',
      exportedAt: new Date().toISOString(),
      questions,
      config,
      currentIdx,
      answers,
      revealed: Array.from(revealed),
      startTime,
    };
    downloadJSON(exp, `quizzer-session-${new Date().toISOString().slice(0, 10)}.json`);
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
    if (isSelected) return 'bg-rose-500/20 border-rose-500 text-rose-200';
    return 'bg-slate-800/40 border-slate-700/50 text-slate-500';
  }

  const getStatus = useCallback((idx: number): QuestionStatus => {
    if (!revealed.has(idx)) return 'unanswered';
    return isAnswerCorrect(questions[idx], answers[idx] ?? []) ? 'correct' : 'wrong';
  }, [revealed, answers, questions]);

  const getStatsForQuestion = useCallback((qId: number) => stats[String(qId)], [stats]);

  const handleResetStat = useCallback((qId: number) => {
    setStats((s) => { const n = { ...s }; delete n[String(qId)]; return n; });
  }, [setStats]);

  const questionCorrect = isRevealed && isAnswerCorrect(q, selected);
  const questionWrong = isRevealed && !isAnswerCorrect(q, selected);

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Top bar */}
      <div className="sticky top-0 z-10 glass border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={() => setShowExitConfirm(true)} className="btn-ghost p-2"><X className="w-5 h-5" /></button>

          <div className="flex gap-3 text-sm font-semibold shrink-0">
            <span className="text-emerald-400">{correct}✓</span>
            <span className="text-rose-400">{wrong}✗</span>
          </div>

          <div className="flex-1">
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${(revealed.size / questions.length) * 100}%` }} />
            </div>
          </div>

          <span className="text-sm text-slate-400 tabular-nums font-medium shrink-0">{currentIdx + 1}/{questions.length}</span>

          <button onClick={() => setPaused(true)} className="btn-ghost p-2" title="Pause">
            <Pause className="w-4 h-4" />
          </button>
          <button onClick={() => setShowSummary(true)} className="btn-ghost p-2" title="Summary">
            <LayoutList className="w-5 h-5" />
          </button>
          <button onClick={handleExportSession} className="btn-ghost p-2" title="Export session">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={handleFinish} className="text-xs text-slate-500 hover:text-slate-300 transition-colors shrink-0">
            Finish
          </button>
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col items-center px-4 py-6 sm:py-10 space-y-5">
        <div className="w-full max-w-3xl space-y-5 animate-slide-up" key={currentIdx}>
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
                {!isRevealed && selected.length > 0 && (
                  <span className="ml-2 text-slate-500 normal-case font-normal">
                    ({selected.length}/{q.selectCount} selected)
                  </span>
                )}
              </p>
            )}
            <p className="text-slate-100 text-base sm:text-lg leading-relaxed">
              <QuestionMarkdown text={q.text} />
            </p>
            {q.image && <QuestionImage src={q.image} />}
          </div>

          <div className="space-y-2.5">
            {q.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => toggleOption(i)}
                disabled={isRevealed}
                className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-150 ${getOptionClass(i)}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold shrink-0 mt-0.5
                    ${selected.includes(i) && !isRevealed ? 'bg-blue-500 text-white' :
                      opt.correct && isRevealed ? 'bg-emerald-500 text-white' :
                      selected.includes(i) && isRevealed ? 'bg-rose-500 text-white' :
                      'bg-slate-700 text-slate-400'}`}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <InlineText text={opt.text} />
                    {opt.image && (
                      <img src={opt.image} alt={`Option ${String.fromCharCode(65 + i)}`}
                        className="mt-2 max-w-full rounded border border-slate-700/50" style={{ maxHeight: '300px' }} />
                    )}
                  </div>
                </div>
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
              <span className="flex-1 text-left font-medium">Notes {noteText ? '(saved)' : ''}</span>
              {notesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {notesOpen && (
              <div className="border-t border-slate-700/50">
                <textarea
                  placeholder="Write your notes in markdown…"
                  value={noteText}
                  onChange={(e) => setNotes((n) => ({ ...n, [String(q.id)]: e.target.value }))}
                  rows={5}
                  className="w-full bg-slate-900/50 px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none resize-none font-mono"
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
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={handlePrev} disabled={currentIdx === 0} className="btn-secondary flex items-center gap-1.5 px-4">
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <div className="flex-1" />
          {!isRevealed ? (
            <button
              onClick={handleCheck}
              disabled={selected.length !== q.selectCount}
              className="btn-primary flex items-center gap-2 px-6 disabled:opacity-40"
              title={selected.length !== q.selectCount ? `Select ${q.selectCount - selected.length} more answer${q.selectCount - selected.length !== 1 ? 's' : ''}` : undefined}
            >
              {q.selectCount > 1 && selected.length < q.selectCount
                ? `Select ${q.selectCount - selected.length} more`
                : 'Check Answer'}
            </button>
          ) : (
            <button onClick={handleNext} className="btn-primary flex items-center gap-2 px-6">
              {currentIdx < questions.length - 1 ? <><span>Next</span><ChevronRight className="w-4 h-4" /></> : 'Finish'}
            </button>
          )}
        </div>
      </div>

      {/* Pause overlay */}
      {paused && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-sm animate-fade-in">
          <p className="text-3xl font-extrabold text-slate-300 mb-2">Paused</p>
          <p className="text-slate-500 text-sm mb-8">{correct}✓ {wrong}✗ · {currentIdx + 1}/{questions.length} questions</p>
          <button onClick={() => setPaused(false)} className="btn-primary flex items-center gap-2 px-8 py-3 text-base">
            <Play className="w-5 h-5" /> Resume
          </button>
        </div>
      )}

      {/* Summary modal */}
      {showSummary && (
        <SummaryModal
          questions={questions}
          currentIdx={currentIdx}
          getStatus={getStatus}
          getStats={getStatsForQuestion}
          onResetStat={handleResetStat}
          onNavigate={navigate}
          onClose={() => setShowSummary(false)}
        />
      )}

      {/* Exit confirm */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-sm p-6 animate-slide-up">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Exit Practice?</h2>
              <button onClick={() => setShowExitConfirm(false)} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-slate-400 text-sm mb-6">Your progress is auto-saved and can be resumed later. Notes are already saved.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowExitConfirm(false)} className="btn-secondary flex-1">Continue</button>
              <button onClick={onExit} className="btn-primary flex-1">Exit &amp; Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
