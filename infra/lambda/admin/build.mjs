#!/usr/bin/env node
// Bundles the admin Lambda with esbuild (AWS SDK v3 clients included, no Docker) into
// lambda/admin/dist/index.mjs. Terraform zips that directory with `archive_file`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync, statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, 'dist');
rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: [join(here, 'src', 'index.ts')],
  outfile: join(outdir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const size = statSync(join(outdir, 'index.mjs')).size;
console.log(`built lambda/admin/dist/index.mjs (${(size / 1024).toFixed(0)} KiB)`);
