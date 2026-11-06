import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Bold, Italic, Code, List, Link2, Eye, EyeOff } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

/**
 * Markdown editor with a small formatting toolbar and a rendered preview.
 * Not a contentEditable WYSIWYG: it edits the same Markdown the app renders, so the
 * preview is exactly what learners will see (react-markdown, no raw HTML).
 */
export default function MarkdownEditor({ value, onChange, placeholder, rows = 4, className = '' }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function wrap(before: string, after = before) {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const sel = value.slice(a, b);
    onChange(value.slice(0, a) + before + sel + after + value.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  }

  function prefix(p: string) {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const start = value.lastIndexOf('\n', a - 1) + 1;
    const end = value.indexOf('\n', b);
    const stop = end === -1 ? value.length : end;
    const block = value
      .slice(start, stop)
      .split('\n')
      .map((l) => p + l)
      .join('\n');
    onChange(value.slice(0, start) + block + value.slice(stop));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + p.length, start + block.length);
    });
  }

  const btn = 'p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/60 transition-colors';

  return (
    <div className={className}>
      <div className="flex items-center gap-0.5 mb-1.5">
        <button type="button" onClick={() => wrap('**')} className={btn} title="Grassetto"><Bold className="w-4 h-4" /></button>
        <button type="button" onClick={() => wrap('*')} className={btn} title="Corsivo"><Italic className="w-4 h-4" /></button>
        <button type="button" onClick={() => wrap('`')} className={btn} title="Codice inline"><Code className="w-4 h-4" /></button>
        <button type="button" onClick={() => wrap('\n```\n', '\n```\n')} className={btn} title="Blocco di codice"><Code className="w-4 h-4" /><span className="sr-only">blocco</span></button>
        <button type="button" onClick={() => prefix('- ')} className={btn} title="Elenco"><List className="w-4 h-4" /></button>
        <button type="button" onClick={() => wrap('[', '](https://)')} className={btn} title="Link"><Link2 className="w-4 h-4" /></button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className={`${btn} ${preview ? 'text-amber-400' : ''}`}
          title={preview ? 'Modifica Markdown' : 'Anteprima'}
        >
          {preview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {preview ? (
        <div className="min-h-[4rem] rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-2 prose prose-invert prose-sm max-w-none text-slate-300">
          {value.trim()
            ? <ReactMarkdown>{value}</ReactMarkdown>
            : <p className="text-slate-600 text-sm">Anteprima vuota</p>}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="input font-mono text-sm resize-y"
          spellCheck={false}
        />
      )}
    </div>
  );
}
