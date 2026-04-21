import { useState } from 'react';
import { Clock, BookOpen, Layers, HardDrive, AlertTriangle, CheckCircle2, Database } from 'lucide-react';
import type { Mode, SessionConfig, Question } from '../types';
import BackupRestoreModal from './BackupRestoreModal';

interface Props {
  questionCount: number;
  loadError: boolean;
  isImported: boolean;
  onSelectMode: (mode: Mode) => void;
  onSetQuestions: (questions: Question[], persist: boolean) => void;
  onClearImported: () => void;
  onBackup: () => void;
  onRestoreData: (data: { questions?: Question[]; notes?: Record<string, string> }) => void;
  defaultConfigs: Record<Mode, SessionConfig>;
}

const MODES: { mode: Mode; icon: React.ReactNode; title: string; color: string; desc: string; badge: string }[] = [
  {
    mode: 'exam',
    icon: <Clock className="w-8 h-8" />,
    title: 'Exam Mode',
    color: 'from-rose-500/20 to-orange-500/10 border-rose-500/30 hover:border-rose-400/60',
    desc: 'Timed simulation of the real exam. Configurable duration and passing score. Results revealed only at the end.',
    badge: 'Timed',
  },
  {
    mode: 'practice',
    icon: <BookOpen className="w-8 h-8" />,
    title: 'Practice Mode',
    color: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/30 hover:border-emerald-400/60',
    desc: 'No time pressure. Instant feedback after each answer. Add personal notes per question, saved across sessions.',
    badge: 'No Timer',
  },
  {
    mode: 'flashcard',
    icon: <Layers className="w-8 h-8" />,
    title: 'Flashcard Mode',
    color: 'from-blue-500/20 to-violet-500/10 border-blue-500/30 hover:border-blue-400/60',
    desc: 'Flip through questions as cards. All options on the back, correct ones highlighted. Notes shown too.',
    badge: 'Review',
  },
];

export default function HomeScreen({
  questionCount,
  loadError,
  isImported,
  onSelectMode,
  onClearImported,
  onBackup,
  onRestoreData,
  defaultConfigs,
}: Props) {
  const [showDataModal, setShowDataModal] = useState(false);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 animate-fade-in">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <span className="text-slate-900 font-extrabold text-2xl">Q</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent">
            AWS Quizzer
          </h1>
        </div>
        <p className="text-slate-400 text-sm sm:text-base">
          AWS Developer Associate (DVA-C02) · Practice Tests
        </p>

        {/* Questions status */}
        <div className="mt-3 inline-flex items-center gap-2 text-sm">
          {loadError ? (
            <span className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              Run <code className="bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">npm run parse</code> to load questions
            </span>
          ) : questionCount > 0 ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              {questionCount} questions loaded
              {isImported && <span className="text-amber-400 text-xs">(imported)</span>}
            </span>
          ) : null}
        </div>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-4xl mb-6">
        {MODES.map(({ mode, icon, title, color, desc, badge }) => (
          <button
            key={mode}
            onClick={() => onSelectMode(mode)}
            disabled={questionCount === 0}
            className={`group relative text-left p-6 rounded-2xl border bg-gradient-to-br ${color}
              transition-all duration-200 hover:scale-[1.02] hover:shadow-xl disabled:opacity-40 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-amber-500/50`}
          >
            <span className="absolute top-4 right-4 text-xs font-semibold text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full">
              {badge}
            </span>
            <div className="text-slate-300 mb-3">{icon}</div>
            <h2 className="text-xl font-bold text-slate-100 mb-2">{title}</h2>
            <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
            <div className="mt-4 text-sm font-semibold text-slate-300 group-hover:text-amber-400 transition-colors">
              {defaultConfigs[mode].questionCount} questions →
            </div>
          </button>
        ))}
      </div>

      {/* Data management button */}
      <button
        onClick={() => setShowDataModal(true)}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors py-2"
      >
        {isImported ? <Database className="w-4 h-4 text-amber-500" /> : <HardDrive className="w-4 h-4" />}
        Backup · Restore · Import
      </button>

      {showDataModal && (
        <BackupRestoreModal
          currentQuestionCount={questionCount}
          isImported={isImported}
          onClose={() => setShowDataModal(false)}
          onBackup={onBackup}
          onRestoreData={onRestoreData}
          onClearImported={onClearImported}
        />
      )}
    </div>
  );
}
