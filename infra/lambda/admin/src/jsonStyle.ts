// Re-serialize an edited JSON file the way the original was written, so a one-question edit
// stays a one-question diff. The style (indent, line endings, trailing newline, BOM) is
// detected by checking that re-serializing the *unedited* value reproduces the file byte for
// byte; when no candidate does (escapes like \uXXXX, hand-formatted arrays...) the result
// falls back to 2-space/compact output and `exact` is false so callers can say so.

const BOM = '﻿';
const INDENTS: Array<number | string | undefined> = [undefined, 2, 4, '\t'];

export interface JsonStyle {
  /** True when the style reproduces the original file exactly (minimal diff guaranteed). */
  exact: boolean;
  stringify(value: unknown): string;
}

export function parseJsonText(raw: string): unknown {
  return JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw);
}

export function detectJsonStyle(raw: string): JsonStyle {
  const bom = raw.startsWith(BOM);
  const text = bom ? raw.slice(1) : raw;
  const parsed: unknown = JSON.parse(text);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(text) ? nl : '';
  const render = (value: unknown, indent: number | string | undefined) =>
    (bom ? BOM : '') + JSON.stringify(value, null, indent).replace(/\n/g, nl) + trailing;

  for (const indent of INDENTS) {
    if (render(parsed, indent) === raw) return { exact: true, stringify: (v) => render(v, indent) };
  }
  const indent = text.includes('\n') ? 2 : undefined;
  return { exact: false, stringify: (v) => render(v, indent) };
}
