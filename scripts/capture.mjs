// Capture screenshots and a short tour video of a running CFLIX server.
// Usage: NODE_PATH=/tmp/opencode/node_modules node scripts/capture.mjs <outdir> [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const B = process.argv[3] || 'http://localhost:3000';
if (!OUT) { console.error('usage: capture.mjs <outdir> [baseUrl]'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(B + '/screens/02-sign-in.html');
await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  let r = await post('/api/auth/signup', { email: 'shot@test.dev', password: 'pw123456' });
  if (r.error) r = await post('/api/auth/signin', { email: 'shot@test.dev', password: 'pw123456' });
  const token = r.session.token;
  const prof = await fetch('/api/profiles', { headers: { authorization: `Bearer ${token}` } }).then((r2) => r2.json());
  let p = prof.items[0];
  if (!p) p = await fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'Demo', maturity: 'adult' }) }).then((r2) => r2.json());
  sessionStorage.setItem('cflix_token', token);
  sessionStorage.setItem('cflix_profile', JSON.stringify(p));
});

const pages = [
  ['index', '/index.html'],
  ['signin', '/screens/02-sign-in.html'],
  ['profiles', '/profiles.html'],
  ['home', '/screens/05-home-page.html'],
  ['detail', '/screens/09-title-detail.html'],
  ['player', '/screens/10-player-scroll.html'],
];

for (const [name, path] of pages) {
  await page.goto(B + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
const vp = await ctx.newPage();
await vp.goto(B + '/index.html', { waitUntil: 'networkidle' });
await vp.waitForTimeout(800);
await vp.evaluate(() => window.scrollTo({ top: 600, behavior: 'smooth' }));
await vp.waitForTimeout(1200);
await vp.goto(B + '/screens/05-home-page.html', { waitUntil: 'networkidle' });
await vp.waitForTimeout(1200);
await vp.evaluate(() => window.scrollTo({ top: 900, behavior: 'smooth' }));
await vp.waitForTimeout(1500);
await vp.close();
await ctx.close();
await browser.close();
