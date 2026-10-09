#!/usr/bin/env node
// End-to-end check of the AWS build against the local gateway mock, plus a Pages-build smoke test.
// Playwright is NOT a dependency of this repo: pass the path of an installed `playwright-core`.
//
//   node e2e/aws-mock.e2e.mjs --data <datasets-dir> --pw <path/to/node_modules/playwright-core> \
//        [--chromium <chrome executable>] [--out <screenshots dir>] [--port 4200]
//
// <datasets-dir> must contain aws-dva-c02/ and mule-mcd-01/ (copies or checkouts of the dataset
// repos, kept OUTSIDE this repository). Builds go to a temp dir; nothing is written to the repo.

import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
if (!args.data || !args.pw) { console.error('usage: --data <datasets-dir> --pw <playwright-core dir> [--chromium <exe>] [--out <dir>] [--port 4200]'); process.exit(2); }
const DATA = resolve(args.data);
const PORT = Number(args.port ?? 4200);
const PAGES_PORT = PORT + 1;
const SOURCE_PORT = PORT + 2;
const TMP = mkdtempSync(join(tmpdir(), 'quizzer-e2e-'));
const OUT = resolve(args.out ?? join(TMP, 'shots'));
mkdirSync(OUT, { recursive: true });

const { chromium } = await import(pathToFileURL(join(resolve(args.pw), 'index.mjs')).href);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function build(mode, outDir) {
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.VITE_BASE_PATH;
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error', ...(mode ? ['--mode', mode] : [])], { cwd: ROOT, env, stdio: 'inherit' });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };
function staticServer(root, { cors = false, spa = false } = {}) {
  return createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = resolve(root, '.' + (p.endsWith('/') ? p + 'index.html' : p));
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(400); return res.end(); }
    try { if (!statSync(file).isFile()) throw 0; } catch { if (!spa) { res.writeHead(404); return res.end(); } file = join(root, 'index.html'); }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', ...(cors ? { 'access-control-allow-origin': '*' } : {}) });
    res.end(readFileSync(file));
  });
}
const listen = (srv, port) => new Promise((r) => srv.listen(port, 'localhost', r));

// ── builds + servers ───────────────────────────────────────────────────────
const AWS_DIST = join(TMP, 'aws');
const PAGES_DIST = join(TMP, 'pages');
build('aws', AWS_DIST);
build(null, PAGES_DIST);

const TTL = 40; // short session so that the scheduled refresh is observable
const mock = spawn(process.execPath, [join(ROOT, 'server/mock/server.mjs'), '--dist', AWS_DIST, '--data', DATA, '--port', String(PORT), '--secret', 'e2e-secret', '--ttl', String(TTL)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => mock.stdout.once('data', r));

const pagesSrv = staticServer(PAGES_DIST, { spa: true });
await listen(pagesSrv, PAGES_PORT);
// A "Static URL" source for the Pages build: index.json at the root, dataset folders next to it.
writeFileSync(join(TMP, 'url-index.json'), JSON.stringify({ schemaVersion: 1, datasets: [{ id: 'mule-mcd-01', title: 'MCD via URL source', file: 'mule-mcd-01/questions.json' }] }));
const sourceSrv = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/index.json') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return res.end(readFileSync(join(TMP, 'url-index.json'))); }
  staticServer(DATA, { cors: true }).emit('request', req, res);
});
await listen(sourceSrv, SOURCE_PORT);

const browser = await chromium.launch({ executablePath: args.chromium, headless: true });
const APP = `http://localhost:${PORT}`;
const shot = async (page, name) => { await page.waitForTimeout(600); return page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true }); };

async function login(page, email, groups) {
  await page.goto(`${APP}/`);
  await page.waitForURL(/\/auth\/mock-idp/);
  await page.fill('input[name=email]', email);
  for (const g of groups) await page.check(`input[name=group][value="${g}"]`);
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-testid=user-email]');
}

async function answerFirstPractice(page) {
  await page.getByRole('button', { name: /Practice Mode/ }).click();
  await page.getByRole('switch').first().click(); // shuffle off → question #1 first
  await page.getByRole('button', { name: /Start Session/ }).click();
  const opts = page.locator('div.space-y-2\\.5 > button');
  await opts.first().waitFor();
  const n = await opts.count();
  for (let i = 0; i < n; i++) {
    const check = page.getByRole('button', { name: /Check Answer/ });
    if (await check.isEnabled().catch(() => false)) break;
    await opts.nth(i).click();
  }
  await page.getByRole('button', { name: /Check Answer/ }).click();
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();

  // 1. unauthenticated → login
  const r0 = await page.goto(`${APP}/`);
  check('unauthenticated visit redirects to the login', /\/auth\/mock-idp\?state=/.test(page.url()), page.url());
  void r0;
  await shot(page, '01-login');

  // 2. user with only ds-aws-dva-c02
  await login(page, 'alice@example.com', ['ds-aws-dva-c02']);
  await page.waitForSelector('text=questions loaded');
  const meA = await page.evaluate(() => fetch('/auth/me').then((r) => r.json()));
  check('alice: /auth/me ds = [aws-dva-c02]', JSON.stringify(meA.ds) === '["aws-dva-c02"]', JSON.stringify(meA.ds));
  const st = await page.evaluate(async () => ({
    own: (await fetch('/data/aws-dva-c02/index.json')).status,
    other: (await fetch('/data/mule-mcd-01/questions.json')).status,
    otherImg: (await fetch('/data/mule-mcd-01/images/q001_A.jpeg')).status,
    traversal: (await fetch('/data/aws-dva-c02/%2e%2e/mule-mcd-01/questions.json')).status,
  }));
  check('alice: /data/aws-dva-c02/index.json → 200', st.own === 200, String(st.own));
  check('alice: /data/mule-mcd-01/questions.json → 403', st.other === 403, String(st.other));
  check('alice: /data/mule-mcd-01/images/… → 403', st.otherImg === 403, String(st.otherImg));
  check('alice: encoded traversal → rejected (400 or normalised then 403)', st.traversal === 400 || st.traversal === 403, String(st.traversal));
  await shot(page, '02-alice-home');
  await page.getByRole('button', { name: /^Datasets$/ }).click();
  await page.waitForSelector('[data-testid=hosted-datasets] button:has-text("DVA-C02")');
  const listA = await page.locator('[data-testid=hosted-datasets]').innerText();
  check('alice sees only the AWS dataset', listA.includes('DVA-C02') && !/MuleSoft|MCD/.test(listA), listA.replace(/\s+/g, ' ').slice(0, 160));
  check('bundled dataset hidden (no "Built in" section)', (await page.locator('text=Built in').count()) === 0);
  await shot(page, '03-alice-datasets');
  await page.locator('summary:has-text("Avanzate")').click();
  await shot(page, '03b-alice-avanzate');
  await page.getByLabel('Close').click();

  // session keeper: with a 40 s session the client refreshes at half-life
  const seen = [];
  page.on('request', (r) => seen.push(`${r.method()} ${new URL(r.url()).pathname}`));
  await page.waitForTimeout((TTL / 2 + 3) * 1000);
  check('scheduled refresh: POST /auth/refresh issued before expiry', seen.includes('POST /auth/refresh'), seen.filter((x) => x.includes('/auth/')).join(', '));
  // 401 → refresh → retry: drop only the session cookie, then list datasets (apiFetch)
  await ctx.clearCookies({ name: '__Host-qz_session' });
  seen.length = 0;
  await page.getByRole('button', { name: /^Datasets$/ }).click();
  await page.waitForSelector('[data-testid=hosted-datasets] button:has-text("DVA-C02")');
  const i401 = seen.indexOf('GET /data/aws-dva-c02/index.json');
  check('expired session cookie: 401 → POST /auth/refresh → retry succeeds', i401 >= 0 && seen.indexOf('POST /auth/refresh', i401) > i401 && seen.lastIndexOf('GET /data/aws-dva-c02/index.json') > seen.indexOf('POST /auth/refresh', i401), seen.join(', '));
  await page.getByLabel('Close').click();

  // progress for alice
  await answerFirstPractice(page);
  const keysA = await page.evaluate(() => Object.keys(localStorage));
  const statsKeyA = `quizzer_stats:u:${meA.sub}:hosted:aws-dva-c02`;
  check('alice: stats stored under quizzer_stats:u:<sub>:hosted:aws-dva-c02', keysA.includes(statsKeyA), keysA.join(', '));
  await shot(page, '04-alice-practice');

  // service worker present, then logout
  await page.goto(`${APP}/`);
  await page.waitForSelector('[data-testid=user-email]');
  const swInfo = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    sessionStorage.setItem('private', 'x');
    const c = await caches.open('runtime-test'); await c.put('/data/aws-dva-c02/fake', new Response('secret'));
    return { scope: reg.scope, caches: await caches.keys() };
  });
  check('service worker active (precache present)', swInfo.caches.some((n) => n.startsWith('workbox-precache')), swInfo.caches.join(', '));
  // With the SW in control, a navigation to /auth/* must reach the gateway (denylist), not the cached index.html
  const authNav = await page.goto(`${APP}/auth/me`);
  const authBody = await page.locator('body').innerText();
  check('SW denylist: navigating to /auth/me returns the gateway JSON, not the app shell', authNav.headers()['content-type']?.includes('application/json') && authBody.includes('"sub"'), authBody.slice(0, 80));
  const dataNav = await page.goto(`${APP}/data/mule-mcd-01/questions.json`);
  check('SW denylist: navigating to /data/<other>/… gets the gateway 403', dataNav.status() === 403, String(dataNav.status()));
  await page.goto(`${APP}/`);
  await page.waitForSelector('[data-testid=user-email]');
  // SW must not answer /auth/* navigations with index.html: /auth/logged-out must come from the mock
  await page.getByRole('button', { name: /Esci/ }).click();
  await page.waitForURL(/\/signed-out\.html/);
  // (the auth pages have a strict CSP without connect-src: probe with the context's request API, same cookies)
  const afterLogout = await page.evaluate(async () => ({ title: document.title, ss: sessionStorage.length, caches: await caches.keys() }));
  afterLogout.me = (await ctx.request.get(`${APP}/auth/me`)).status();
  afterLogout.data = (await ctx.request.get(`${APP}/data/aws-dva-c02/index.json`)).status();
  const cookies = await ctx.cookies();
  check('logout: /auth/logout reached the gateway and ended on /signed-out.html', /sei uscito/i.test(afterLogout.title), afterLogout.title);
  check('logout: session + refresh cookies gone', !cookies.some((c) => c.name.includes('qz_session') || c.name.includes('qz_refresh')), cookies.map((c) => c.name).join(','));
  check('logout: sessionStorage cleared', afterLogout.ss === 0);
  check('logout: runtime caches cleared, precache kept', !afterLogout.caches.includes('runtime-test') && afterLogout.caches.some((n) => n.startsWith('workbox-precache')), afterLogout.caches.join(', '));
  check('logout: /auth/me 401, /data 401', afterLogout.me === 401 && afterLogout.data === 401, `${afterLogout.me}/${afterLogout.data}`);
  await shot(page, '05-logged-out');

  // offline: app shell from the SW cache, banner shown (no session)
  await ctx.setOffline(true);
  await page.goto(`${APP}/`).catch(() => {});
  await page.waitForSelector('[data-auth-state=offline]', { timeout: 10_000 }).catch(() => {});
  check('offline: app shell from SW + offline banner', (await page.locator('[data-auth-state=offline]').count()) === 1);
  await shot(page, '06-offline');
  await ctx.setOffline(false);

  // both cookies gone (refresh revoked/expired): next API call → redirect to the login
  {
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await login(p2, 'carol@example.com', ['ds-aws-dva-c02']);
    await c2.clearCookies();
    await p2.getByRole('button', { name: /^Datasets$/ }).click();
    await p2.waitForURL(/\/auth\/mock-idp/, { timeout: 10_000 }).catch(() => {});
    check('no session and no refresh cookie: client redirects to /auth/login', /\/auth\/mock-idp/.test(p2.url()), p2.url());
    // 360 px wide: user chip + Esci fit
    await login(p2, 'a-very-long-email-address-for-testing@example-company.com', ['ds-aws-dva-c02']);
    await p2.setViewportSize({ width: 360, height: 780 });
    await shot(p2, '12-mobile-360');
    const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('360 px: no horizontal overflow with a long email', !overflow);
    await c2.close();
  }

  // 3. second user, ds-all, same browser profile
  await login(page, 'bob@example.com', ['ds-all']);
  const meB = await page.evaluate(() => fetch('/auth/me').then((r) => r.json()));
  check('bob: ds = [*], allDatasets = both', JSON.stringify(meB.ds) === '["*"]' && JSON.stringify(meB.allDatasets) === '["aws-dva-c02","mule-mcd-01"]', JSON.stringify(meB));
  const keysB0 = await page.evaluate(() => Object.keys(localStorage));
  check('bob starts without progress (alice\'s key untouched, none for bob)', keysB0.includes(statsKeyA) && !keysB0.some((k) => k.startsWith(`quizzer_stats:u:${meB.sub}`)), keysB0.join(', '));
  await page.getByRole('button', { name: /Dataset$/ }).click(); // per-question stats screen
  await page.waitForTimeout(300);
  await shot(page, '07-bob-dataset-stats');
  const statsText = await page.locator('body').innerText();
  await page.goto(`${APP}/`);
  await page.waitForSelector('[data-testid=user-email]');
  await page.getByRole('button', { name: /^Datasets$/ }).click();
  await page.waitForSelector('[data-testid=hosted-datasets] button:has-text("MuleSoft")');
  const listB = await page.locator('[data-testid=hosted-datasets]').innerText();
  check('bob sees both datasets', listB.includes('DVA-C02') && listB.includes('MuleSoft'), listB.replace(/\s+/g, ' ').slice(0, 200));
  await shot(page, '08-bob-datasets');
  await page.locator('[data-testid=hosted-datasets] button:has-text("MuleSoft")').click();
  await page.waitForSelector('text=226 questions loaded');

  // MCD question 1 has an exhibit and four image options
  await page.getByRole('button', { name: /Practice Mode/ }).click();
  await page.getByRole('switch').first().click();
  await page.getByRole('button', { name: /Start Session/ }).click();
  await page.waitForSelector('img[alt="Option A"]');
  await page.waitForFunction(() => [...document.images].length >= 5 && [...document.images].every((i) => i.complete));
  const imgs = await page.evaluate(() => [...document.images].map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth })));
  check('MCD option images render (naturalWidth > 0)', imgs.length >= 5 && imgs.every((i) => i.w > 0), JSON.stringify(imgs));
  check('MCD images are plain /data URLs (no blob:)', imgs.every((i) => i.src.startsWith('/data/mule-mcd-01/images/')));
  await shot(page, '09-bob-mcd-images');
  await page.locator('div.space-y-2\\.5 > button').first().click();
  await page.getByRole('button', { name: /Check Answer/ }).click();
  const keysB = await page.evaluate(() => Object.keys(localStorage));
  check('bob: progress in his own keys only', keysB.includes(`quizzer_stats:u:${meB.sub}:hosted:mule-mcd-01`) && !keysB.includes(`quizzer_stats:u:${meA.sub}:hosted:mule-mcd-01`), keysB.filter((k) => k.startsWith('quizzer_stats')).join(', '));
  const aliceStats = await page.evaluate((k) => localStorage.getItem(k), statsKeyA);
  check('alice\'s stats unchanged after bob\'s session', aliceStats && JSON.parse(aliceStats)['1'] !== undefined, aliceStats ?? '');
  void statsText;
  await ctx.close();

  // 4. Pages build: bundled dataset + Static URL source, no backend
  const pctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const pp = await pctx.newPage();
  const authCalls = [];
  pp.on('request', (r) => { if (/\/auth\//.test(r.url())) authCalls.push(r.url()); });
  await pp.goto(`http://localhost:${PAGES_PORT}/`);
  await pp.waitForSelector('text=387 questions loaded');
  check('Pages: bundled dataset loads (387 questions)', true);
  await pp.getByRole('button', { name: /^Datasets$/ }).click();
  check('Pages: "Built in" section shown', (await pp.locator('text=Built in').count()) === 1);
  await pp.getByRole('button', { name: /Add a source/ }).click();
  await pp.fill('input[placeholder^="Name"]', 'Local URL');
  await pp.getByRole('button', { name: 'Static URL' }).click();
  await pp.fill('input[placeholder^="https://host"]', `http://localhost:${SOURCE_PORT}/`);
  await pp.getByRole('button', { name: 'Add', exact: true }).click();
  await pp.waitForSelector('button:has-text("MCD via URL source")');
  await shot(pp, '10-pages-sources');
  await pp.locator('button:has-text("MCD via URL source")').click();
  await pp.waitForSelector('text=226 questions loaded');
  check('Pages: Static URL source loads (226 questions)', true);
  const keysP = await pp.evaluate(() => Object.keys(localStorage));
  check('Pages: unchanged key scheme (quizzer_sources, <source>:<dataset>)', keysP.includes('quizzer_sources') && keysP.includes('quizzer_active_dataset') && !keysP.some((k) => k.includes(':u:')), keysP.join(', '));
  check('Pages: no /auth/* request at all', authCalls.length === 0, authCalls.join(', '));
  await shot(pp, '11-pages-home');
  await pctx.close();
} catch (e) {
  check('e2e run', false, e.stack);
} finally {
  await browser.close();
  mock.kill();
  pagesSrv.close();
  sourceSrv.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
