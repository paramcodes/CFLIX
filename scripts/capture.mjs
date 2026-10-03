import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const B = process.argv[3] || 'http://localhost:3000';
if (!OUT) {
  console.error('usage: capture.mjs <outdir> [baseUrl]');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(B + '/signin');
const seed = await page.evaluate(async () => {
  const post = (p, b) =>
    fetch(p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    }).then((r) => r.json());
  let r = await post('/api/auth/signup', {
    email: 'shot@test.dev',
    password: 'pw123456',
  });
  if (r.error)
    r = await post('/api/auth/signin', {
      email: 'shot@test.dev',
      password: 'pw123456',
    });
  const token = r.session.token;
  const prof = await fetch('/api/profiles', {
    headers: { authorization: `Bearer ${token}` },
  }).then((r2) => r2.json());
  let p = prof.items[0];
  if (!p)
    p = await fetch('/api/profiles', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'Demo', maturity: 'adult' }),
    }).then((r2) => r2.json());
  sessionStorage.setItem('cflix_token', token);
  sessionStorage.setItem('cflix_profile', JSON.stringify(p));
  const browse = await fetch('/api/catalog/browse?kind=movie', {
    headers: {
      authorization: `Bearer ${token}`,
      'x-cflix-profile': p.id,
    },
  }).then((r3) => r3.json());
  return { token, profile: p, seedId: browse.items[0].id };
});

const pages = [
  ['index', '/'],
  ['signin', '/signin'],
  ['profiles', '/profiles'],
  ['home', '/home'],
  ['detail', `/title?id=${seed.seedId}`],
  ['player', '/watch'],
];

for (const [name, path] of pages) {
  await page.goto(B + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
await ctx.addInitScript(
  ([t, p]) => {
    sessionStorage.setItem('cflix_token', t);
    sessionStorage.setItem('cflix_profile', p);
  },
  [seed.token, JSON.stringify(seed.profile)],
);
const vp = await ctx.newPage();
await vp.goto(B + '/', { waitUntil: 'networkidle' });
await vp.waitForTimeout(800);
await vp.evaluate(() => window.scrollTo({ top: 600, behavior: 'smooth' }));
await vp.waitForTimeout(1200);
await vp.goto(B + '/home', { waitUntil: 'networkidle' });
await vp.waitForTimeout(1200);
await vp.evaluate(() => window.scrollTo({ top: 900, behavior: 'smooth' }));
await vp.waitForTimeout(1500);
await vp.close();
await ctx.close();
await browser.close();
