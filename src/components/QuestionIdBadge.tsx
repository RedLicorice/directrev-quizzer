/**
 * Small, stable question identifier shown next to every question so learners can cite it
 * when reporting an error or a correction. `select-all` makes a single click select the id.
 */
export default function QuestionIdBadge({ id, className = '' }: { id: number; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border border-slate-600/50 bg-slate-700/40 px-1.5 py-0.5 select-all font-mono text-[11px] tabular-nums text-slate-400 ${className}`}
      title={`Question ID ${id} — cite this when reporting an error or correction`}
      aria-label={`Question ID ${id}`}
    >
      #{id}
    </span>
  );
}
