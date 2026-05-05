import { useRef, useState } from 'react';
import { ArrowLeft, Play, Zap, RotateCcw, Upload } from 'lucide-react';
import type { Mode, SessionConfig, PracticeSessionDraft } from '../types';
import { DEFAULT_CONFIGS } from '../types';

interface Props {
  mode: Mode;
  totalQuestions: number;
  savedDraft: PracticeSessionDraft | null;
  onStart: (mode: Mode, config: SessionConfig) => void;
  onResume: (draft: PracticeSessionDraft) => void;
  onImportSession: (data: unknown) => boolean;
  onBack: () => void;
}

const LABELS: Record<Mode, { title: string; color: string }> = {
  exam: { title: 'Exam Mode', color: 'text-rose-400' },
  practice: { title: 'Practice Mode', color: 'text-emerald-400' },
  flashcard: { title: 'Flashcard Mode', color: 'text-blue-400' },
};

export default function ConfigScreen({ mode, totalQuestions, savedDraft, onStart, onResume, onImportSession, onBack }: Props) {
  const [config, setConfig] = useState<SessionConfig>({ ...DEFAULT_CONFIGS[mode] });
  const [importError, setImportError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const maxQ = Math.max(totalQuestions, 1);
  const { title, color } = LABELS[mode];

  function update<K extends keyof SessionConfig>(key: K, val: SessionConfig[K]) {
    setConfig((c) => ({ ...c, [key]: val }));
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const ok = onImportSession(data);
        if (!ok) setImportError(true);
      } catch { setImportError(true); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const draftProgress = savedDraft
    ? `Q${savedDraft.currentIdx + 1}/${savedDraft.questionIds.length} · ${savedDraft.revealed.length} answered`
    : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 animate-slide-up">
      <div className="w-full max-w-lg">
        <button onClick={onBack} className="btn-ghost flex items-center gap-2 mb-6 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="card p-8 space-y-6">
          <div>
            <p className={`text-sm font-semibold uppercase tracking-widest ${color} mb-1`}>Configure</p>
            <h1 className="text-2xl font-bold">{title}</h1>
          </div>

          {/* Resume saved draft (practice only) */}
          {mode === 'practice' && savedDraft && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-3">
              <div className="flex items-start gap-2">
                <RotateCcw className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">Saved session found</p>
                  <p className="text-xs text-slate-400 mt-0.5">{draftProgress} · saved {new Date(savedDraft.savedAt).toLocaleString()}</p>
                </div>
              </div>
              <button
                onClick={() => onResume(savedDraft)}
                className="w-full btn-primary flex items-center justify-center gap-2 py-2"
              >
                <Play className="w-4 h-4" /> Resume Session
              </button>
            </div>
          )}

          {/* Import session (practice only) */}
          {mode === 'practice' && (
            <div>
              <button
                onClick={() => { setImportError(false); fileRef.current?.click(); }}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                <Upload className="w-4 h-4" /> Import saved session (.json)
              </button>
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
              {importError && (
                <p className="text-xs text-rose-400 mt-1">Invalid session file — expected a quizzer-session export.</p>
              )}
            </div>
          )}

          {/* Question count */}
          <div className="space-y-2">
            <label className="flex justify-between text-sm font-medium text-slate-300">
              <span>Questions</span>
              <span className="text-amber-400 font-bold">{config.questionCount}</span>
            </label>
            <input
              type="range"
              min={5}
              max={maxQ}
              step={5}
              value={config.questionCount}
              onChange={(e) => update('questionCount', Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>5</span><span>{maxQ} available</span>
            </div>
          </div>

          {/* Shuffle */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-slate-300">Shuffle questions</p>
              <p className="text-xs text-slate-500">Randomize order each session</p>
            </div>
            <button
              role="switch"
              aria-checked={config.shuffle}
              onClick={() => update('shuffle', !config.shuffle)}
              className={`relative w-11 h-6 rounded-full transition-colors ${config.shuffle ? 'bg-amber-500' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${config.shuffle ? 'left-6' : 'left-1'}`} />
            </button>
          </label>

          {/* Time limit (exam only) */}
          {mode === 'exam' && (
            <div className="space-y-2">
              <label className="flex justify-between text-sm font-medium text-slate-300">
                <span>Time limit</span>
                <span className="text-amber-400 font-bold">
                  {config.timeLimit === 0 ? 'Unlimited' : `${config.timeLimit} min`}
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={240}
                step={10}
                value={config.timeLimit}
                onChange={(e) => update('timeLimit', Number(e.target.value))}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>Unlimited</span><span>240 min</span>
              </div>
            </div>
          )}

          {/* Passing score (exam / practice) */}
          {mode !== 'flashcard' && (
            <div className="space-y-2">
              <label className="flex justify-between text-sm font-medium text-slate-300">
                <span>Passing score</span>
                <span className="text-amber-400 font-bold">{config.passingScore}%</span>
              </label>
              <input
                type="range"
                min={50}
                max={100}
                step={1}
                value={config.passingScore}
                onChange={(e) => update('passingScore', Number(e.target.value))}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>50%</span><span>100%</span>
              </div>
            </div>
          )}

          {/* Practice-only options */}
          {mode === 'practice' && (
            <>
              {/* Weak Mode toggle */}
              <div className="space-y-3">
                <button
                  onClick={() => update('weakMode', !config.weakMode)}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all
                    ${config.weakMode
                      ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                      : 'bg-slate-700/30 border-slate-700/50 text-slate-400 hover:border-slate-600'}`}
                >
                  <Zap className={`w-5 h-5 shrink-0 ${config.weakMode ? 'text-rose-400' : 'text-slate-500'}`} />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold">Weak Mode</p>
                    <p className="text-xs opacity-70 mt-0.5">Only pick questions with &lt;60% success rate or unseen</p>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors ${config.weakMode ? 'bg-rose-500' : 'bg-slate-600'}`}>
                    <div className={`w-3 h-3 rounded-full bg-white mt-1 transition-all ${config.weakMode ? 'ml-5' : 'ml-1'}`} />
                  </div>
                </button>
              </div>

              {/* Question bias (only when weak mode off) */}
              {!config.weakMode && (
                <div className="space-y-2">
                  <label className="flex justify-between text-sm font-medium text-slate-300">
                    <span>Question weighting</span>
                    <span className="text-amber-400 font-bold text-xs">
                      {config.bias < 0.3 ? 'Reinforce strengths' : config.bias > 0.7 ? 'Target weaknesses' : 'Balanced'}
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={config.bias}
                    onChange={(e) => update('bias', Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Strengths</span>
                    <span className="text-slate-600">Balanced (0.5)</span>
                    <span>Weaknesses</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {config.bias < 0.3
                      ? 'Selects questions you typically answer correctly — good for confidence building.'
                      : config.bias > 0.7
                      ? 'Selects questions you typically answer incorrectly — good for targeted study.'
                      : 'Random selection, unaffected by your answer history.'}
                  </p>
                </div>
              )}
            </>
          )}

          <button
            onClick={() => onStart(mode, config)}
            className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3"
          >
            <Play className="w-4 h-4" /> Start Session
          </button>
        </div>
      </div>
    </div>
  );
}
