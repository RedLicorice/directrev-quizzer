// Builds both flavours into a temp dir and checks invariants of the generated output:
//  - Pages build: no hosted/auth code paths, bundled dataset + github/url sources still there,
//    SW without the AWS denylist, no external font hosts.
//  - AWS build: SW navigateFallbackDenylist + NetworkOnly for /auth, /data, /api; no bundled dataset.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const OUT = mkdtempSync(join(tmpdir(), 'quizzer-builds-'));

function build(mode: string | null, outDir: string, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'production', ...extraEnv };
  const args = ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error', ...(mode ? ['--mode', mode] : [])];
  execFileSync('npx', args, { cwd: ROOT, env, stdio: 'pipe' });
}

function js(dir: string): string {
  const assets = join(dir, 'assets');
  // app code only: the bundled questions chunk is data (its text mentions "hosted", "data/"…)
  return readdirSync(assets).filter((f) => f.endsWith('.js') && !f.startsWith('questions-')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
}

const PAGES = join(OUT, 'pages');
const AWS = join(OUT, 'aws');

beforeAll(() => {
  build(null, PAGES, { VITE_BASE_PATH: '/directrev-quizzer/' });
  build('aws', AWS);
  return () => rmSync(OUT, { recursive: true, force: true });
});

const AWS_ONLY = ['/auth/me', '/auth/refresh', '/auth/login', '/auth/logout', 'x-amz-content-sha256', '"hosted"', 'Esci', 'Avanzate', 'workbox-precache', 'data/'];

describe('GitHub Pages build (npm run build)', () => {
  it('contains no hosted/auth code', () => {
    const code = js(PAGES);
    for (const s of AWS_ONLY) expect(code.includes(s), s).toBe(false);
    expect(readdirSync(join(PAGES, 'assets')).some((f) => f.startsWith('AuthGate'))).toBe(false);
  });
  it('still ships the bundled dataset and the github/url source code paths', () => {
    expect(readdirSync(join(PAGES, 'assets')).some((f) => /^questions-.*\.js$/.test(f))).toBe(true);
    const code = js(PAGES);
    expect(code).toContain('raw.githubusercontent.com');
    expect(code).toContain('api.github.com');
    expect(code).toContain('quizzer_sources');
    expect(code).toContain('aws-dva-c02');
  });
  it('keeps its base path, manifest and a service worker without the AWS denylist', () => {
    const html = readFileSync(join(PAGES, 'index.html'), 'utf8');
    expect(html).toContain('/directrev-quizzer/assets/');
    expect(html).toContain('<title>AWS Quizzer</title>');
    const manifest = JSON.parse(readFileSync(join(PAGES, 'manifest.webmanifest'), 'utf8'));
    expect(manifest.name).toBe('AWS Quizzer');
    expect(manifest.start_url).toBe('/directrev-quizzer/');
    const sw = readFileSync(join(PAGES, 'sw.js'), 'utf8');
    expect(sw).not.toContain('/^\\/auth\\//');
    expect(readdirSync(PAGES).includes('signed-out.html')).toBe(false);
    expect(sw).toContain('NavigationRoute');
  });
  it('uses self-hosted fonts only', () => {
    const html = readFileSync(join(PAGES, 'index.html'), 'utf8');
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(readdirSync(join(PAGES, 'assets')).some((f) => /^inter-latin-400-normal-.*\.woff2$/.test(f))).toBe(true);
  });
});

describe('AWS build (npm run build -- --mode aws)', () => {
  it('service worker never serves index.html for /auth, /data, /api and never caches them', () => {
    const sw = readFileSync(join(AWS, 'sw.js'), 'utf8');
    expect(sw).toContain('denylist:[/^\\/auth\\//,/^\\/data\\//,/^\\/api\\//]');
    for (const p of ['/data/', '/auth/', '/api/']) expect(sw).toMatch(new RegExp(`startsWith\\("${p.replace(/\//g, '\\/')}"\\),new \\w+\\.NetworkOnly`));
    expect(sw).toContain('cleanupOutdatedCaches');
  });
  it('ships the public /signed-out.html (logout landing page, CONTRACT §1)', () => {
    const html = readFileSync(join(AWS, 'signed-out.html'), 'utf8');
    expect(html).toContain('/auth/login?return=%2F');
    expect(html).not.toMatch(/<script|https?:\/\//);
  });
  it('manifest: name Quizzer, start_url and scope "/"', () => {
    const m = JSON.parse(readFileSync(join(AWS, 'manifest.webmanifest'), 'utf8'));
    expect(m).toMatchObject({ name: 'Quizzer', start_url: '/', scope: '/' });
  });
  it('<title> matches the manifest name (not the Pages-only "AWS Quizzer")', () => {
    expect(readFileSync(join(AWS, 'index.html'), 'utf8')).toContain('<title>Quizzer</title>');
  });
  it('contains the auth client and no bundled dataset', () => {
    const code = js(AWS);
    for (const s of ['/auth/me', '/auth/refresh', '/auth/login', '/auth/logout', 'x-amz-content-sha256']) expect(code).toContain(s);
    expect(readdirSync(join(AWS, 'assets')).some((f) => /^questions-.*\.js$/.test(f))).toBe(false);
    expect(readFileSync(join(AWS, 'index.html'), 'utf8')).not.toMatch(/https?:\/\//);
  });
});
