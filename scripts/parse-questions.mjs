#!/usr/bin/env node
/**
 * Parses a Ditectrev-format README.md into questions.json.
 * Images referenced in question/option text are embedded as base64 data URLs.
 * Usage: node scripts/parse-questions.mjs [input.md] [output.json]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(__dirname, '../assets/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers/README.md');

const outputPath = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(__dirname, '../src/data/questions.json');

const imagesDir = dirname(inputPath);

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function loadImage(relPath) {
  const absPath = join(imagesDir, relPath);
  if (!existsSync(absPath)) return null;
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME[ext] ?? 'image/jpeg';
  const data = readFileSync(absPath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

function extractImage(lines, start, end) {
  for (let i = start; i < end; i++) {
    const m = lines[i].match(/!\[.*?\]\(([^)]+)\)/);
    if (m) return loadImage(m[1]);
  }
  return undefined;
}

function parseReadme(content) {
  const questions = [];
  const sections = content.split(/^### /m);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    const text = lines[0].trim();
    if (!text) continue;

    // Find first option line index
    let firstOptIdx = lines.length;
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].match(/^- \[([ xX])\]/)) { firstOptIdx = j; break; }
    }

    // Question image: in body between heading and first option
    const questionImage = extractImage(lines, 1, firstOptIdx);

    const options = [];
    for (let j = 0; j < lines.length; j++) {
      const m = lines[j].match(/^- \[([ xX])\] (.+)$/);
      if (!m) continue;
      // Option image: next non-empty line after this checkbox line
      let optImage;
      for (let k = j + 1; k < lines.length && k <= j + 3; k++) {
        if (!lines[k].trim()) continue;
        const imgM = lines[k].match(/!\[.*?\]\(([^)]+)\)/);
        if (imgM) { optImage = loadImage(imgM[1]); }
        break;
      }
      const opt = { text: m[2].trim(), correct: m[1].toLowerCase() === 'x' };
      if (optImage) opt.image = optImage;
      options.push(opt);
    }

    if (options.length < 2) continue;
    const correctCount = options.filter((o) => o.correct).length;
    if (correctCount === 0) continue;

    const q = { id: questions.length + 1, text, options, selectCount: correctCount };
    if (questionImage) q.image = questionImage;
    questions.push(q);
  }

  return questions;
}

const content = readFileSync(inputPath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const questions = parseReadme(content);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(questions), 'utf-8');

const withImages = questions.filter((q) => q.image || q.options.some((o) => o.image)).length;
console.log(`✓ Parsed ${questions.length} questions (${withImages} with images)`);
console.log(`  Input:  ${inputPath}`);
console.log(`  Output: ${outputPath}`);
