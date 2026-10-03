import { chromium } from 'playwright';

const base = process.env.BASE || 'http://localhost:3105';

const signup = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `links-${Date.now()}@example.com`, password: 'hunter2hunter2' }),
});
const created = await signup.json();
const token = created.session?.token;
const profile = await fetch(`${base}/api/profiles`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: 'Link Check', maturity: 'adult' }),
});
const prof = await profile.json();
const id = prof.id ?? prof.profile?.id ?? prof.user?.id;
console.log(`session seeded: token=${token.slice(0, 12)}... profile=${id}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(([t, p]) => {
  sessionStorage.setItem('cflix_token', t);
  sessionStorage.setItem('cflix_profile', JSON.stringify({ id: p, name: 'Link Check', maturity: 'adult' }));
}, [token, id]);
const page = await ctx.newPage();

const audit = async (path) => {
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const anchors = [...document.querySelectorAll('a')];
    const underlined = anchors.filter((a) => {
      const d = getComputedStyle(a).textDecorationLine;
      return d !== 'none' && d !== '';
    });
    return {
      url: location.pathname,
      anchors: anchors.length,
      underlined: underlined.length,
      samples: underlined.slice(0, 5).map((a) => `${a.textContent.trim().slice(0, 24)}=${getComputedStyle(a).textDecorationLine}`),
      deadHash: anchors.filter((a) => a.getAttribute('href') === '#').length,
      landBack: document.querySelectorAll('.land__back').length,
      footerCols: document.querySelectorAll('.footer__col').length,
      footerNote: (document.querySelector('.footer__note')?.textContent || '').trim(),
      backLinkToPrototype: anchors.filter((a) => a.getAttribute('href') === 'prototype-index.html').length,
    };
  });
};

for (const p of ['/', '/signin', '/home']) {
  const r = await audit(p);
  console.log(JSON.stringify(r));
}

await browser.close();
