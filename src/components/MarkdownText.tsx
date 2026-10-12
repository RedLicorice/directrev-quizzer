import ReactMarkdown from 'react-markdown';
import DatasetImage from './DatasetImage';

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

/** Multi-line text or source code (RAML, DataWeave, XML…) as opposed to a plain sentence. */
export function looksLikeCode(text: string): boolean {
  return text.includes('\n') || /^\s*(%dw\b|#%RAML|<\?xml|<[a-zA-Z][\w:.-]*[\s/>])/.test(text);
}

/**
 * Answer option text: plain sentences keep inline backtick handling, code / multi-line text
 * keeps its line breaks and indentation in a monospace block. Long unbroken tokens
 * (URLs, DataWeave expressions) wrap instead of widening the card. Safe inside <button>.
 */
export function OptionText({ text }: { text: string }) {
  if (looksLikeCode(text)) {
    return (
      <span className="block whitespace-pre-wrap font-mono text-[0.88em] leading-relaxed overflow-x-auto [overflow-wrap:anywhere]">
        {text}
      </span>
    );
  }
  return (
    <span className="[overflow-wrap:anywhere]">
      <InlineText text={text} />
    </span>
  );
}

/** Full markdown for question body text (supports code, bold, italic, links) */
export function QuestionMarkdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`[overflow-wrap:anywhere] ${className}`}>
      <ReactMarkdown
        components={{
          // Prevent ReactMarkdown from wrapping in a block <p> — keep inline flow
          p: ({ children }) => <span>{children}</span>,
          // Fenced/indented code blocks (RAML, DataWeave…): always wrapped in <pre> by
          // ReactMarkdown, never for inline `code` spans — so this is the one reliable
          // signal to tell block code apart from inline code.
          pre: ({ children }) => (
            <pre className="block whitespace-pre overflow-x-auto rounded my-1 [overflow-wrap:anywhere]">
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="bg-slate-700/70 px-1.5 py-0.5 rounded text-[0.88em] font-mono text-amber-300 break-words">
              {children}
            </code>
          ),
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          // Route markdown images through DatasetImage so they get lazy loading, private-repo
          // resolution and the fullscreen zoom/pan viewer.
          img: ({ src, alt }) =>
            typeof src === 'string' ? (
              <DatasetImage src={src} alt={alt ?? ''} className="my-2 max-w-full rounded border border-slate-700/50" />
            ) : null,
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
