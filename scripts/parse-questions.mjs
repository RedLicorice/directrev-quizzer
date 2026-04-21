#!/usr/bin/env node
/**
 * Parses a Ditectrev-format README.md into questions.json.
 * Usage: node scripts/parse-questions.mjs [input.md] [output.json]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(__dirname, '../assets/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers/README.md');

const outputPath = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(__dirname, '../src/data/questions.json');

function parseReadme(content) {
  const questions = [];
  // Split on H3 headings that mark questions (after the table of contents)
  const sections = content.split(/^### /m);

  // Find where real questions start (after TOC ends, look for sections with options)
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    const text = lines[0].trim();

    if (!text) continue;

    const options = [];
    for (const line of lines) {
      const m = line.match(/^- \[([ xX])\] (.+)$/);
      if (m) {
        options.push({
          text: m[2].trim(),
          correct: m[1].toLowerCase() === 'x',
        });
      }
    }

    // Skip sections without options (e.g. TOC headers)
    if (options.length < 2) continue;

    const correctCount = options.filter((o) => o.correct).length;
    if (correctCount === 0) continue;

    questions.push({
      id: questions.length + 1,
      text,
      options,
      selectCount: correctCount,
    });
  }

  return questions;
}

const content = readFileSync(inputPath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const questions = parseReadme(content);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(questions, null, 2), 'utf-8');

console.log(`✓ Parsed ${questions.length} questions`);
console.log(`  Input:  ${inputPath}`);
console.log(`  Output: ${outputPath}`);
