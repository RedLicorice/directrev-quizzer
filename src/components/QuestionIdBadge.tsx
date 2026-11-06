/**
 * Small, stable question identifier shown next to every question so learners can cite it
 * when reporting an error or a correction. `sourceNumber` is the number in the source
 * document when the dataset provides one; the internal `id` is always kept in the tooltip.
 * `select-all` makes a single click select the badge text.
 */
export default function QuestionIdBadge({ id, sourceNumber, className = '' }: { id: number; sourceNumber?: string; className?: string }) {
  const label = sourceNumber ? `Q${sourceNumber}` : `#${id}`;
  const title = sourceNumber
    ? `Question ${sourceNumber} (internal id ${id}) — cite this when reporting an error or correction`
    : `Question ID ${id} — cite this when reporting an error or correction`;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border border-slate-600/50 bg-slate-700/40 px-1.5 py-0.5 select-all font-mono text-[11px] tabular-nums text-slate-400 ${className}`}
      title={title}
      aria-label={sourceNumber ? `Question ${sourceNumber}` : `Question ID ${id}`}
    >
      {label}
    </span>
  );
}
