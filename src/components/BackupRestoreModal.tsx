import { useRef, useState } from 'react';
import { X, Download, Upload, AlertTriangle, CheckCircle2, FileJson, FileText, Info } from 'lucide-react';
import type { Question } from '../types';
import { parseMarkdown } from '../utils/parseMarkdown';

interface Props {
  currentQuestionCount: number;
  isImported: boolean;
  onClose: () => void;
  onBackup: () => void;
  onRestoreData: (data: { questions?: Question[]; notes?: Record<string, string> }) => void;
  onClearImported: () => void;
}

type ParsedFile =
  | { kind: 'backup'; questions: Question[] | null; notes: Record<string, string> | null; filename: string }
  | { kind: 'questions'; questions: Question[]; filename: string }
  | { kind: 'error'; message: string; filename: string };

type ConfirmStage = 'idle' | 'confirming';

function parseFile(text: string, filename: string): ParsedFile {
  if (filename.toLowerCase().endsWith('.md')) {
    const questions = parseMarkdown(text);
    if (questions.length === 0)
      return { kind: 'error', message: 'No questions found — ensure it is a Ditectrev README.md', filename };
    return { kind: 'questions', questions, filename };
  }
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    if (json.version === 1 && (json.questions != null || json.notes != null)) {
      return {
        kind: 'backup',
        questions: Array.isArray(json.questions) ? (json.questions as Question[]) : null,
        notes: json.notes && typeof json.notes === 'object' ? (json.notes as Record<string, string>) : null,
        filename,
      };
    }
    if (Array.isArray(json)) {
      const qs = json as Question[];
      if (qs.length === 0 || !qs[0].text)
        return { kind: 'error', message: 'JSON is not a valid questions array', filename };
      return { kind: 'questions', questions: qs, filename };
    }
    return { kind: 'error', message: 'Unrecognised JSON format — expected backup or questions array', filename };
  } catch {
    return { kind: 'error', message: 'Invalid JSON', filename };
  }
}

function noteCount(): number {
  try {
    const n = JSON.parse(localStorage.getItem('quizzer_notes') ?? '{}') as Record<string, string>;
    return Object.values(n).filter((v) => v.trim()).length;
  } catch {
    return 0;
  }
}

export default function BackupRestoreModal({
  currentQuestionCount,
  isImported,
  onClose,
  onBackup,
  onRestoreData,
  onClearImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [restoreQ, setRestoreQ] = useState(true);
  const [restoreN, setRestoreN] = useState(true);
  const [confirmStage, setConfirmStage] = useState<ConfirmStage>('idle');
  const [confirmClear, setConfirmClear] = useState(false);

  const notes = noteCount();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseFile(text, file.name);
      setParsed(result);
      // Pre-select checkboxes based on what the file contains
      if (result.kind === 'backup') {
        setRestoreQ(result.questions !== null);
        setRestoreN(result.notes !== null);
      } else {
        setRestoreQ(true);
        setRestoreN(false);
      }
      setConfirmStage('idle');
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function availableQ(): Question[] | null {
    if (!parsed) return null;
    if (parsed.kind === 'error') return null;
    return parsed.questions ?? null;
  }

  function availableN(): Record<string, string> | null {
    if (!parsed || parsed.kind !== 'backup') return null;
    return parsed.notes ?? null;
  }

  const canRestoreQ = availableQ() !== null && restoreQ;
  const canRestoreN = availableN() !== null && restoreN;
  const canRestore = canRestoreQ || canRestoreN;

  function destructiveLabel() {
    if (canRestoreQ && canRestoreN) return 'questions and notes';
    if (canRestoreQ) return 'questions';
    return 'notes';
  }

  function handleRestoreClick() {
    if (!canRestore) return;
    setConfirmStage('confirming');
  }

  function handleConfirmedRestore() {
    const data: { questions?: Question[]; notes?: Record<string, string> } = {};
    if (canRestoreQ) data.questions = availableQ()!;
    if (canRestoreN) data.notes = availableN()!;
    onRestoreData(data);
    onClose();
  }

  function handleConfirmedClear() {
    onClearImported();
    setConfirmClear(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-700/50">
          <h2 className="text-lg font-semibold">Data Management</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* ── Backup ── */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Backup</p>
            <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-700/30 border border-slate-700/50">
              <div className="text-sm text-slate-400">
                Export current questions and notes to a single JSON file.
                <div className="flex gap-3 mt-1 text-xs text-slate-500">
                  <span>{currentQuestionCount} questions</span>
                  <span>·</span>
                  <span>{notes} note{notes !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <button
                onClick={onBackup}
                className="btn-secondary flex items-center gap-2 whitespace-nowrap shrink-0 text-sm"
              >
                <Download className="w-4 h-4" /> Download
              </button>
            </div>
          </section>

          {/* ── Active source ── */}
          {isImported && (
            <section>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Active Questions Source</p>
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2.5 text-sm text-amber-300">
                  <Info className="w-4 h-4 shrink-0" />
                  Using imported questions ({currentQuestionCount} total)
                </div>
                {!confirmClear ? (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="text-xs text-rose-400 hover:text-rose-300 transition-colors shrink-0"
                  >
                    Revert to bundled
                  </button>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-rose-300">Sure?</span>
                    <button onClick={handleConfirmedClear} className="text-xs bg-rose-500 hover:bg-rose-400 text-white px-2 py-1 rounded-lg">Yes</button>
                    <button onClick={() => setConfirmClear(false)} className="text-xs text-slate-400 hover:text-slate-200">No</button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Restore ── */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Restore</p>

            {/* File picker */}
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2.5 p-4 rounded-xl border-2 border-dashed border-slate-600
                hover:border-amber-500/50 hover:bg-amber-500/5 transition-all text-sm text-slate-400 hover:text-slate-200"
            >
              <Upload className="w-4 h-4" />
              Choose file
              <span className="text-slate-600 text-xs">.json · .md</span>
            </button>
            <input ref={fileRef} type="file" accept=".json,.md" className="hidden" onChange={handleFileChange} />

            {/* Parsed result */}
            {parsed && (
              <div className="mt-4 space-y-4 animate-slide-up">
                {parsed.kind === 'error' ? (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    {parsed.message}
                  </div>
                ) : (
                  <>
                    {/* Detection badge */}
                    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-700/40 border border-slate-700/50">
                      {parsed.kind === 'backup'
                        ? <FileJson className="w-4 h-4 text-amber-400" />
                        : <FileText className="w-4 h-4 text-blue-400" />
                      }
                      <div className="text-sm">
                        <span className="text-slate-300 font-medium">{parsed.filename}</span>
                        <span className="text-slate-500 ml-2 text-xs">
                          {parsed.kind === 'backup' ? 'Backup file' : parsed.kind === 'questions' ? 'Questions array' : 'README.md'}
                        </span>
                      </div>
                    </div>

                    {/* Checkboxes */}
                    <div className="space-y-2.5">
                      {/* Questions */}
                      <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
                        ${availableQ() === null ? 'opacity-40 cursor-not-allowed border-slate-700/30 bg-slate-800/20' :
                          restoreQ ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-700/50 bg-slate-700/20'}`}>
                        <input
                          type="checkbox"
                          checked={restoreQ && availableQ() !== null}
                          disabled={availableQ() === null}
                          onChange={(e) => { setRestoreQ(e.target.checked); setConfirmStage('idle'); }}
                          className="accent-amber-500 w-4 h-4"
                        />
                        <div className="flex-1 text-sm">
                          <span className="font-medium text-slate-300">Questions</span>
                          {availableQ() !== null
                            ? <span className="ml-2 text-slate-500">{availableQ()!.length} questions</span>
                            : <span className="ml-2 text-slate-600">not in this file</span>
                          }
                        </div>
                        {availableQ() !== null && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      </label>

                      {/* Notes (backup only) */}
                      <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
                        ${availableN() === null ? 'opacity-40 cursor-not-allowed border-slate-700/30 bg-slate-800/20' :
                          restoreN ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-700/50 bg-slate-700/20'}`}>
                        <input
                          type="checkbox"
                          checked={restoreN && availableN() !== null}
                          disabled={availableN() === null}
                          onChange={(e) => { setRestoreN(e.target.checked); setConfirmStage('idle'); }}
                          className="accent-amber-500 w-4 h-4"
                        />
                        <div className="flex-1 text-sm">
                          <span className="font-medium text-slate-300">Notes</span>
                          {availableN() !== null
                            ? <span className="ml-2 text-slate-500">
                                {Object.values(availableN()!).filter((v) => v.trim()).length} notes
                              </span>
                            : <span className="ml-2 text-slate-600">not in this file</span>
                          }
                        </div>
                        {availableN() !== null && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      </label>
                    </div>

                    {/* Confirm stage */}
                    {confirmStage === 'idle' && (
                      <button
                        onClick={handleRestoreClick}
                        disabled={!canRestore}
                        className="btn-primary w-full flex items-center justify-center gap-2"
                      >
                        <Upload className="w-4 h-4" /> Restore Selected
                      </button>
                    )}

                    {confirmStage === 'confirming' && (
                      <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-3 animate-slide-up">
                        <div className="flex items-start gap-2.5 text-sm text-rose-300">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>
                            This will <strong>permanently overwrite</strong> your current {destructiveLabel()}.
                            This cannot be undone.
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setConfirmStage('idle')}
                            className="btn-secondary flex-1 text-sm py-2"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleConfirmedRestore}
                            className="flex-1 text-sm py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-semibold transition-colors"
                          >
                            Yes, Overwrite
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
