import type { Question } from '../types';

export function parseMarkdown(content: string): Question[] {
  const questions: Question[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sections = normalized.split(/^### /m);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    const text = lines[0].trim();
    if (!text) continue;

    const options: Question['options'] = [];
    for (const line of lines) {
      const m = line.match(/^- \[([ xX])\] (.+)$/);
      if (m) options.push({ text: m[2].trim(), correct: m[1].toLowerCase() === 'x' });
    }

    if (options.length < 2) continue;
    const correctCount = options.filter((o) => o.correct).length;
    if (correctCount === 0) continue;

    questions.push({ id: questions.length + 1, text, options, selectCount: correctCount });
  }

  return questions;
}
