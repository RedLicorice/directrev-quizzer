import { useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import type { Mode, SessionConfig } from '../types';
import { DEFAULT_CONFIGS } from '../types';

interface Props {
  mode: Mode;
  totalQuestions: number;
  onStart: (mode: Mode, config: SessionConfig) => void;
  onBack: () => void;
}

const LABELS: Record<Mode, { title: string; color: string }> = {
  exam: { title: 'Exam Mode', color: 'text-rose-400' },
  practice: { title: 'Practice Mode', color: 'text-emerald-400' },
  flashcard: { title: 'Flashcard Mode', color: 'text-blue-400' },
};

export default function ConfigScreen({ mode, totalQuestions, onStart, onBack }: Props) {
  const [config, setConfig] = useState<SessionConfig>({ ...DEFAULT_CONFIGS[mode] });

  const maxQ = Math.max(totalQuestions, 1);
  const { title, color } = LABELS[mode];

  function update<K extends keyof SessionConfig>(key: K, val: SessionConfig[K]) {
    setConfig((c) => ({ ...c, [key]: val }));
  }

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
