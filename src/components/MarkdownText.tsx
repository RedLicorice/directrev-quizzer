import ReactMarkdown from 'react-markdown';

/** Inline rendering: converts backtick code spans to <code> — safe inside <button> */
export function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.length > 2 && part[0] === '`' && part[part.length - 1] === '`' ? (
          <code key={i} className="bg-black/25 px-1 rounded text-[0.88em] font-mono">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Full markdown for question body text (supports code, bold, italic, links) */
export function QuestionMarkdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={className}>
      <ReactMarkdown
        components={{
          // Prevent ReactMarkdown from wrapping in a block <p> — keep inline flow
          p: ({ children }) => <span>{children}</span>,
          code: ({ children }) => (
            <code className="bg-slate-700/70 px-1.5 py-0.5 rounded text-[0.88em] font-mono text-amber-300 break-words">
              {children}
            </code>
          ),
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a href={href} className="underline text-blue-400" target="_blank" rel="noreferrer">{children}</a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  );
}
