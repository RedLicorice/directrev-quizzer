import ReactMarkdown from 'react-markdown';
import { Lightbulb } from 'lucide-react';
import type { Question } from '../types';
import DatasetImage from './DatasetImage';

/** Explanation shipped with the dataset (read-only, separate from the user's own notes). */
export default function ExplanationBlock({ q }: { q: Question }) {
  if (!q.explanation && !q.explanationImage) return null;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-amber-400 border-b border-slate-700/50">
        <Lightbulb className="w-4 h-4" /> Explanation
      </div>
      <div className="px-4 py-3 prose prose-invert prose-sm max-w-none text-slate-300">
        {q.explanation && (
          <ReactMarkdown
            components={{
              img: ({ src, alt }) =>
                typeof src === 'string' ? (
                  <DatasetImage src={src} alt={alt ?? ''} className="my-2 max-w-full rounded border border-slate-700/50" />
                ) : null,
            }}
          >
            {q.explanation}
          </ReactMarkdown>
        )}
        {q.explanationImage && (
          <DatasetImage src={q.explanationImage} alt="Explanation figure"
            className="max-w-full rounded border border-slate-700/50 mx-auto block" style={{ maxHeight: '400px' }} />
        )}
      </div>
    </div>
  );
}
