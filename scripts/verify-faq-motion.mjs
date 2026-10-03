#!/usr/bin/env node
// Proves the home FAQ open/close animation runs instead of snapping.
// Usage: BASE=http://localhost:3000 NODE_PATH=/tmp/opencode/node_modules node scripts/verify-faq-motion.mjs [outdir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE || 'http://localhost:3000';
const out = process.argv[2] || 'artifacts/verify-cflix/faq-motion';
mkdirSync(out, { recursive: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const CLOSED = 59.2;
const OPEN = 100.9;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'load' });
await page.locator('.land__faq-wrap').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);

// Sample inside one evaluate so the click and the first frame share a tick;
// a round trip per sample would only capture the tail of a 200ms animation.
const track = (target) => page.evaluate(async ({ target, CLOSED, OPEN }) => {
  const d = document.querySelector('.land__faq-item details');
  const heights = [];
  const t0 = performance.now();
  let firstMove = null;
  d.open = target;
  for (let i = 0; i < 90; i++) {
    const h = +d.getBoundingClientRect().height.toFixed(1);
    heights.push(h);
    const moved = target ? h > CLOSED + 0.5 : h < OPEN - 0.5;
    if (firstMove === null && moved) firstMove = performance.now() - t0;
    const end = target ? OPEN : CLOSED;
    if (firstMove !== null && Math.abs(h - end) < 0.6) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return {
    firstMove: firstMove === null ? null : Math.round(firstMove),
    distinct: new Set(heights.map((h) => h.toFixed(1))).size,
    elapsed: Math.round(performance.now() - t0),
    last: heights.at(-1),
  };
}, { target, CLOSED, OPEN });

const opening = await track(true);
ok(opening.firstMove !== null && opening.firstMove <= 100, `open starts moving at ${opening.firstMove}ms`);
ok(opening.distinct >= 4, `open traverses ${opening.distinct} distinct heights`);
ok(opening.elapsed >= 150, `open settles over ${opening.elapsed}ms, not a snap`);
const closing = await track(false);
ok(closing.firstMove !== null && closing.firstMove <= 100, `close starts moving at ${closing.firstMove}ms`);
ok(closing.distinct >= 4, `close traverses ${closing.distinct} distinct heights`);
ok(closing.elapsed >= 150, `close settles over ${closing.elapsed}ms, not a snap`);

const chrome = await page.evaluate(() => {
  const s = document.querySelector('.land__faq-item summary');
  return { cursor: getComputedStyle(s).cursor, listStyle: getComputedStyle(s).listStyleType };
});
ok(chrome.cursor === 'pointer', `summary cursor is ${chrome.cursor}`);
ok(chrome.listStyle === 'none', `summary marker removed, list-style ${chrome.listStyle}`);

const reduced = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const rp = await reduced.newPage();
await rp.goto(base + '/', { waitUntil: 'load' });
await rp.locator('.land__faq-item').first().locator('summary').click();
await rp.waitForTimeout(60);
const instant = await rp.locator('.land__faq-item').first().evaluate((el) => +el.querySelector('details').getBoundingClientRect().height.toFixed(1));
ok(Math.abs(instant - OPEN) < 1, `prefers-reduced-motion opens instantly at ${instant}px`);
await reduced.close();

// Capture pass: the animation clock is slowed so a PNG lands mid-transition.
// Playwright's own locator.screenshot waits for a stable box and would outlast
// the animation, so these are clipped page captures.
const cdp = await ctx.newCDPSession(page);
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });

const wrap = page.locator('.land__faq-wrap');
const item = page.locator('.land__faq-item').first();
const height = () => item.evaluate((el) => +el.querySelector('details').getBoundingClientRect().height.toFixed(1));
const shoot = async (name, label, expected) => {
  const at = await height();
  const b = await wrap.boundingBox();
  await page.screenshot({ path: `${out}/${name}`, clip: b, animations: 'allow' });
  console.log(`      ${name}: ${label} ${at}px, expected ${expected}`);
  return at;
};

await shoot('faq-1-closed.png', 'closed', `${CLOSED}px`);
await item.locator('summary').click();
await page.waitForTimeout(850);
await shoot('faq-2-mid-open.png', 'mid-open between', `${CLOSED}-${OPEN}px`);
await page.waitForTimeout(2600);
await shoot('faq-3-open.png', 'open', `${OPEN}px`);
await item.locator('summary').click();
await page.waitForTimeout(850);
await shoot('faq-4-mid-close.png', 'mid-close between', `${CLOSED}-${OPEN}px`);
await page.waitForTimeout(2600);
await shoot('faq-5-closed.png', 'closed again', `${CLOSED}px`);

await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
