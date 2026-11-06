import { useEffect, useState } from 'react';
import { X, Save, Plus, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import type { Question, Option } from '../../types';
import { getDatasetQuestion, saveDatasetQuestion, errorText, AdminApiError } from './adminApi';
import MarkdownEditor from './MarkdownEditor';

interface Props {
  datasetId: string;
  question: Question;
  onClose: () => void;
  /** Called with the committed question so the app shows it before the publish reaches S3. */
  onSaved: (q: Question) => void;
}

/** Admin editor for one question. Loads the repo copy, edits it and commits it back. */
export default function QuestionEditor({ datasetId, question: initial, onClose, onSaved }: Props) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [sha, setSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reformatted, setReformatted] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setConflict(false);
    setSaved(false);
    try {
      const r = await getDatasetQuestion(datasetId, initial.id);
      setQuestion(r.question);
      setSha(r.sha);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [datasetId, initial.id]);

  function patch(p: Partial<Question>) {
    setQuestion((q) => (q ? { ...q, ...p } : q));
  }
  function patchOption(i: number, p: Partial<Option>) {
    setQuestion((q) => (q ? { ...q, options: q.options.map((o, j) => (j === i ? { ...o, ...p } : o)) } : q));
  }
  function addOption() {
    setQuestion((q) => (q ? { ...q, options: [...q.options, { text: '', correct: false }] } : q));
  }
  function removeOption(i: number) {
    setQuestion((q) => (q && q.options.length > 2 ? { ...q, options: q.options.filter((_, j) => j !== i) } : q));
  }

  async function save() {
    if (!question || !sha) return;
    const options = question.options.map((o) => ({ ...o }));
    const correct = options.filter((o) => o.correct).length;
    if (!question.text.trim() && !question.image) return setError('Il testo della domanda è vuoto.');
    if (options.length < 2) return setError('Servono almeno 2 opzioni.');
    if (correct === 0) return setError('Segna almeno una risposta corretta.');
    if (options.some((o) => !o.text.trim() && !o.image)) return setError('Ogni opzione deve avere testo o immagine.');
    const next: Question = {
      ...question,
      options,
      selectCount: correct,
      sourceNumber: question.sourceNumber?.trim() ? question.sourceNumber.trim() : undefined,
      explanation: question.explanation?.trim() ? question.explanation : undefined,
    };
    setBusy(true);
    setError(null);
    try {
      const out = await saveDatasetQuestion(datasetId, next.id, sha, next);
      setReformatted(out.reformatted === true);
      setSaved(true);
      onSaved(next);
    } catch (e) {
      if (e instanceof AdminApiError && e.code === 'conflict') setConflict(true);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const correct = question ? question.options.filter((o) => o.correct).length : 0;
  const rw = 'text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-3xl max-h-[92vh] flex flex-col animate-slide-up">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-700/50">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              Modifica domanda <span className="font-mono text-amber-400">#{initial.id}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Dataset <span className="font-mono">{datasetId}</span> · le modifiche valgono per tutti dopo il publish (1–2 min)
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {loading && <p className="text-slate-500 text-sm">Caricamento della domanda dal repo…</p>}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p>{error}</p>
                {conflict && (
                  <button onClick={() => void load()} className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300">
                    <RefreshCw className="w-3.5 h-3.5" /> Ricarica la domanda (perdi le modifiche locali)
                  </button>
                )}
              </div>
            </div>
          )}

          {saved && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              <p>
                Modifica committata e già visibile qui. Il publish parte in automatico: per gli altri utenti (e se ricarichi
                il dataset) S3/CloudFront si aggiornano in 1–2 minuti.
              </p>
              {reformatted && (
                <p className="mt-2 text-xs text-amber-300">
                  Attenzione: lo stile originale del file non è riproducibile, quindi il commit riscrive tutto il file
                  (diff più grande di una domanda).
                </p>
              )}
            </div>
          )}

          {question && !saved && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3 items-end">
                <div>
                  <label className={rw}>Numero sorgente</label>
                  <input
                    value={question.sourceNumber ?? ''}
                    onChange={(e) => patch({ sourceNumber: e.target.value })}
                    placeholder={String(question.id)}
                    className="input font-mono text-sm"
                  />
                </div>
                <p className="text-xs text-slate-500 pb-2.5">
                  id interno <span className="font-mono">{question.id}</span> — non cambia mai (stats, note e cronologia sono keyed su di esso).
                </p>
              </div>

              <div>
                <label className={rw}>Testo domanda (Markdown)</label>
                <MarkdownEditor value={question.text} onChange={(text) => patch({ text })} rows={4} placeholder="Testo della domanda…" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`${rw} mb-0`}>Opzioni · {correct} corretta/e</label>
                  <button onClick={addOption} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-400">
                    <Plus className="w-3.5 h-3.5" /> Aggiungi
                  </button>
                </div>
                <div className="space-y-3">
                  {question.options.map((o, i) => (
                    <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-700 text-xs font-bold text-slate-300">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={o.correct}
                            onChange={(e) => patchOption(i, { correct: e.target.checked })}
                            className="accent-emerald-500"
                          />
                          corretta
                        </label>
                        {o.image && <span className="font-mono text-[11px] text-slate-500 truncate">img: {o.image}</span>}
                        <div className="flex-1" />
                        <button
                          onClick={() => removeOption(i)}
                          disabled={question.options.length <= 2}
                          className="p-1 text-slate-600 hover:text-rose-400 disabled:opacity-30"
                          title="Rimuovi opzione"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <MarkdownEditor value={o.text} onChange={(text) => patchOption(i, { text })} rows={2} placeholder={`Testo opzione ${String.fromCharCode(65 + i)}…`} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className={rw}>Spiegazione (Markdown)</label>
                <MarkdownEditor
                  value={question.explanation ?? ''}
                  onChange={(explanation) => patch({ explanation })}
                  rows={5}
                  placeholder="Spiegazione della risposta corretta…"
                />
                {question.explanationImage && (
                  <p className="mt-1 font-mono text-[11px] text-slate-500">immagine spiegazione: {question.explanationImage}</p>
                )}
              </div>

              <p className="text-xs text-slate-600">
                Le immagini e i percorsi restano invariati da qui. selectCount viene impostato automaticamente al numero di risposte corrette.
              </p>
            </>
          )}
        </div>

        <div className="flex gap-3 px-5 py-3 border-t border-slate-700/50">
          <button onClick={onClose} className="btn-secondary flex-1">{saved ? 'Chiudi' : 'Annulla'}</button>
          {!saved && (
            <button
              onClick={() => void save()}
              disabled={busy || loading || !question}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" /> {busy ? 'Salvataggio…' : 'Salva nel dataset'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
