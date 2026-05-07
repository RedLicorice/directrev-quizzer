import type { Question, Stats } from '../types';

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
    h = h & h;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function exportNotesMarkdown(questions: Question[], notes: Record<string, string>): string {
  const lines: string[] = [
    '<!-- AWS Quizzer Notes Export v1 -->',
    `<!-- Generated: ${new Date().toISOString()} -->`,
    '',
  ];

  for (const q of questions) {
    const note = notes[String(q.id)];
    if (!note?.trim()) continue;
    const hash = hashText(q.text);
    lines.push(`## [q:${hash}]`);
    lines.push('');
    lines.push(`<!-- question: ${q.text.slice(0, 80).replace(/\n/g, ' ')} -->`);
    lines.push('');
    lines.push(note.trim());
    lines.push('');
  }

  return lines.join('\n');
}

export function importNotesMarkdown(
  text: string,
  questions: Question[],
): { notes: Record<string, string>; matched: number; total: number } {
  const hashToId = new Map(questions.map((q) => [hashText(q.text), String(q.id)]));

  const notes: Record<string, string> = {};
  let matched = 0;
  let total = 0;

  // Split on ## [q:HASH] headers
  const sections = text.split(/^## \[q:([0-9a-f]{8})\]/m);

  for (let i = 1; i < sections.length; i += 2) {
    const hash = sections[i];
    const body = sections[i + 1] ?? '';
    total++;

    const id = hashToId.get(hash);
    if (!id) continue;

    // Strip leading/trailing whitespace and remove HTML comments
    const cleaned = body.replace(/<!--[^>]*-->/g, '').trim();
    if (!cleaned) continue;

    notes[id] = cleaned;
    matched++;
  }

  return { notes, matched, total };
}

export function isNotesMarkdown(text: string): boolean {
  return text.includes('<!-- AWS Quizzer Notes Export v1 -->');
}

export function exportStatsMarkdown(questions: Question[], stats: Stats): string {
  const lines: string[] = [
    '<!-- AWS Quizzer Stats Export v1 -->',
    `<!-- Generated: ${new Date().toISOString()} -->`,
    '',
  ];

  for (const q of questions) {
    const s = stats[String(q.id)];
    if (!s || s.correct + s.wrong === 0) continue;
    const hash = hashText(q.text);
    lines.push(`## [s:${hash}] correct=${s.correct} wrong=${s.wrong}`);
    lines.push(`<!-- question: ${q.text.slice(0, 80).replace(/\n/g, ' ')} -->`);
    lines.push('');
  }

  return lines.join('\n');
}

export function importStatsMarkdown(
  text: string,
  questions: Question[],
): { stats: Stats; matched: number; total: number } {
  const hashToId = new Map(questions.map((q) => [hashText(q.text), String(q.id)]));

  const stats: Stats = {};
  let matched = 0;
  let total = 0;

  const headerRe = /^## \[s:([0-9a-f]{8})\] correct=(\d+) wrong=(\d+)/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    total++;
    const [, hash, correctStr, wrongStr] = m;
    const id = hashToId.get(hash);
    if (!id) continue;
    stats[id] = { correct: Number(correctStr), wrong: Number(wrongStr) };
    matched++;
  }

  return { stats, matched, total };
}

export function isStatsMarkdown(text: string): boolean {
  return text.includes('<!-- AWS Quizzer Stats Export v1 -->');
}
