import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const B = process.argv[2] || 'http://localhost:3110';
const OUT = process.argv[3] || join(HERE, 'evidence');
mkdirSync(OUT, { recursive: true });

const log = [];
const fail = (msg) => { console.error('FAIL ' + msg); process.exitCode = 1; };
const ok = (msg) => { console.log('ok   ' + msg); log.push('ok   ' + msg); };

async function status(path, opts) {
  const res = await fetch(B + path, opts);
  return { status: res.status, type: res.headers.get('content-type'), len: Number(res.headers.get('content-length') || 0) };
}

for (const [p, want] of [['/', 200], ['/signin', 200]]) {
  const { status: s } = await status(p);
  s === want ? ok(`doctor ${p} -> ${s}`) : fail(`doctor ${p} -> ${s}, want ${want}`);
}
{
  const { status: s } = await status('/api/profiles');
  s === 401 ? ok('doctor /api/profiles -> 401 (auth enforced)') : fail(`/api/profiles -> ${s}, want 401`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('response', (r) => { if (r.url().includes('/posters/')) log.push(`net  ${r.status()} ${r.url().replace(B, '')}`); });

await page.goto(B + '/signin');
await page.evaluate(async () => {
  const post = (p, b, token) => fetch(p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(b),
  }).then((r) => r.json());
  let r = await post('/api/auth/signup', { email: 'thumb@test.dev', password: 'pw123456' });
  if (r.error) r = await post('/api/auth/signin', { email: 'thumb@test.dev', password: 'pw123456' });
  const token = r.session.token;
  const prof = await fetch('/api/profiles', { headers: { authorization: `Bearer ${token}` } }).then((x) => x.json());
  let p = prof.items[0];
  if (!p) p = await post('/api/profiles', { name: 'Demo', maturity: 'adult' }, token);
  sessionStorage.setItem('cflix_token', token);
  sessionStorage.setItem('cflix_profile', JSON.stringify(p));
});

await page.goto(B + '/home', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const rows = await page.evaluate(() => {
  const read = (id) => [...document.querySelectorAll(`#${id} .card`)].map((c) => ({
    title: c.querySelector('.card__title')?.textContent.trim() || '',
    art: c.querySelector('.card__art')?.getAttribute('style') || '',
    cls: c.querySelector('.card__art')?.className || '',
  }));
  return { who: document.querySelector('#who')?.textContent || '', movies: read('row-movies'), series: read('row-series'), cont: read('row-continue') };
});

const all = [...rows.movies, ...rows.series, ...rows.cont];
if (!all.length) fail('no cards rendered on home');
for (const c of all) {
  const m = /url\(['"]?\/posters\/([a-z0-9]+)\.jpg['"]?\)/.exec(c.art);
  if (!m) fail(`card "${c.title}" has no /posters background image (art="${c.art}" cls="${c.cls}")`);
}
const ids = [...new Set(all.map((c) => /\/posters\/([a-z0-9]+)\.jpg/.exec(c.art)?.[1]).filter(Boolean))];
if (ids.length) ok(`${all.length} cards on home render poster art; ids=${ids.join(',')}`);

for (const id of ids) {
  const res = await fetch(`${B}/posters/${id}.jpg`);
  const bytes = (await res.arrayBuffer()).byteLength;
  const type = res.headers.get('content-type');
  if (res.status !== 200 || type !== 'image/jpeg' || bytes <= 0) fail(`/posters/${id}.jpg -> ${res.status} ${type} ${bytes}B`);
}
const fetched = await page.evaluate(() => performance.getEntriesByType('resource')
  .filter((e) => e.name.includes('/posters/'))
  .map((e) => ({ url: e.name.replace(location.origin, ''), bytes: e.decodedBodySize || e.transferSize })));
for (const id of ids) {
  const hit = fetched.find((e) => e.url === `/posters/${id}.jpg`);
  if (!hit) fail(`browser never requested /posters/${id}.jpg`);
  else if (hit.bytes <= 0) fail(`/posters/${id}.jpg arrived with 0 bytes`);
}
ok(`browser requested ${fetched.length} poster resources, all non-empty: ${fetched.map((f) => `${f.url}:${f.bytes}B`).join(' ')}`);

const fallback = await page.evaluate(() => {
  const host = document.createElement('div');
  host.id = 'fallback-probe';
  document.body.appendChild(host);
  fillRow('fallback-probe', [{ id: 'zz', title: 'No Art Yet' }]);
  const art = host.querySelector('.card__art');
  const out = { cls: art?.className || '', bg: art?.getAttribute('style') || '' };
  host.remove();
  return out;
});
/ph--[a-h]\b/.test(fallback.cls) && !fallback.bg.includes('/posters/')
  ? ok(`no-poster item falls back to gradient: class="${fallback.cls}"`)
  : fail(`fallback broken: class="${fallback.cls}" style="${fallback.bg}"`);

await page.screenshot({ path: `${OUT}/home-posters.png`, fullPage: false });
ok(`screenshot ${OUT}/home-posters.png`);
writeFileSync(`${OUT}/evidence.txt`, [`who: ${rows.who}`, ...log, '', JSON.stringify(rows, null, 2)].join('\n'));

await browser.close();
console.log(process.exitCode ? 'VERIFY FAILED' : 'VERIFY PASSED');
