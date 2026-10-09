#!/usr/bin/env node
// Builds edge/session-check.js by inlining edge/session-core.js into the template.
// Comments and blank lines are stripped to keep the function well under the 10 KB limit
// (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html).
// Usage: node edge/build-function.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function buildFunction() {
  const core = readFileSync(join(here, 'session-core.js'), 'utf8');
  const tpl = readFileSync(join(here, 'session-check.template.js'), 'utf8');
  const strip = (src) =>
    src
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .map((l) => l.replace(/\s+$/, '').replace(/^\s+/, ''))
      .filter((l) => l.length > 0)
      .join('\n');
  const coreBody = strip(
    core
      .replace(/^\/\/ @edge-skip-start[^\n]*\n[\s\S]*?^\/\/ @edge-skip-end\n/gm, '')
      .replace(/^export /gm, ''),
  );
  const header = tpl.split('\n').filter((l) => /^\/\//.test(l)).join('\n');
  const body = strip(tpl).replace('/*@@CORE@@*/', coreBody);
  return header + '\n' + body + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(here, 'session-check.js');
  const built = buildFunction();
  if (process.argv.includes('--check')) {
    const current = readFileSync(out, 'utf8');
    if (current !== built) {
      console.error('edge/session-check.js is stale: run `npm run build:edge`');
      process.exit(1);
    }
    console.log('edge/session-check.js is up to date (' + Buffer.byteLength(built) + ' bytes)');
  } else {
    writeFileSync(out, built);
    console.log('wrote ' + out + ' (' + Buffer.byteLength(built) + ' bytes)');
  }
}
