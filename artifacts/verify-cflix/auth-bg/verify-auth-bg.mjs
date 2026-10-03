import { chromium } from 'playwright';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = process.env.BASE || 'http://localhost:3102';
const out = process.argv[2] || 'artifacts/verify-cflix/auth-bg';
mkdirSync(out, { recursive: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const srgb = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); };
const rgbOf = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const f = (n) => n.toFixed(2);

// The sign-in page used to sit on solid #0a0a0a; that is the legibility bar.
const BASE_L = lum(10, 10, 10);

// Text painted directly on the background image.
const TEXT = [
  ['.auth-title', '#ffffff', 'Sign In heading'],
  ['.auth-divider', '#808080', 'OR divider'],
  ['#in-error', '#eb3942', 'error text'],
  ['.auth-link', '#b3b3b3', 'Forgot Password link'],
  ['.auth-check span', '#b3b3b3', 'Remember me label'],
  ['.auth-cta', '#ffffff', 'CFLIX sign up line'],
  ['.auth-fine', '#6d6d6e', 'terms fine print'],
];

// Opaque controls whose fill has to separate from the image behind it.
const CONTROLS = [
  ['#btn-signin', '#e50914', 'red Sign In button'],
  ['.field__box', '#1f1f1f', 'input field box'],
];

const report = [];
const browser = await chromium.launch();

for (const vp of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${base}/screens/02-sign-in.html`, { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo(0, 0));

  const tag = `${vp.width}x${vp.height}`;
  await page.screenshot({ path: `${out}/sign-in-${tag}.png`, fullPage: true });

  await page.fill('#in-email', 'wrong@example.com');
  await page.fill('#in-password', 'not-the-password');
  await page.click('#btn-signin');
  await page.waitForFunction(() => document.querySelector('#in-error').textContent.trim().length > 0);
  const errText = (await page.textContent('#in-error')).trim();
  await page.screenshot({ path: `${out}/sign-in-error-${tag}.png`, fullPage: true });

  const form = await page.locator('.auth-col').boundingBox();
  await page.screenshot({ path: `${out}/sign-in-form-${tag}.png`, clip: form });

  const boxes = {};
  for (const [sel] of [...TEXT, ...CONTROLS]) boxes[sel] = await page.locator(sel).first().boundingBox();

  // Same page with the form hidden, so sampled pixels are the raw background
  // the text actually sits on.
  await page.addStyleTag({ content: '.auth-col { visibility: hidden !important; }' });
  const png = `/tmp/opencode/.bg-${tag}.png`;
  const raw = `/tmp/opencode/.bg-${tag}.rgb`;
  await page.screenshot({ path: png, fullPage: true });
  execFileSync('magick', [png, '-depth', '8', `rgb:${raw}`]);
  const [W, H] = execFileSync('magick', ['identify', '-format', '%w %h', png]).toString().split(' ').map(Number);
  const buf = readFileSync(raw);
  rmSync(png); rmSync(raw);

  const at = (x, y) => {
    const i = (y * W + x) * 3;
    return lum(buf[i], buf[i + 1], buf[i + 2]);
  };
  const region = (b, pad = 0, skip = null) => {
    const x0 = Math.max(0, Math.floor(b.x - pad));
    const y0 = Math.max(0, Math.floor(b.y - pad));
    const x1 = Math.min(W - 1, Math.ceil(b.x + b.width + pad));
    const y1 = Math.min(H - 1, Math.ceil(b.y + b.height + pad));
    let max = 0, min = 1, sum = 0, n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (skip && x >= skip.x && x <= skip.x + skip.width && y >= skip.y && y <= skip.y + skip.height) continue;
        const l = at(x, y);
        if (l > max) max = l;
        if (l < min) min = l;
        sum += l; n++;
      }
    }
    return { max, min, mean: n ? sum / n : 0 };
  };

  const page0 = region({ x: 0, y: 0, width: W, height: H });
  ok(page0.max - page0.min > 0.05, `[${tag}] background image renders (luminance range ${f(page0.max - page0.min)})`);

  for (const [sel, color, label] of TEXT) {
    const l = lum(...rgbOf(color));
    const bg = region(boxes[sel]);
    const r = ratio(l, bg.max);
    const base0 = ratio(l, BASE_L);
    report.push(`${tag}\t${label}\ttext ${color}\tworst bg L ${bg.max.toFixed(4)}\tcontrast ${r.toFixed(2)}:1\tbaseline on #0a0a0a ${base0.toFixed(2)}:1`);
    ok(r >= base0 - 0.2, `[${tag}] ${label} over image ${f(r)}:1 vs ${f(base0)}:1 baseline`);
  }

  for (const [sel, color, label] of CONTROLS) {
    const l = lum(...rgbOf(color));
    const ring = region(boxes[sel], 14, boxes[sel]);
    const worst = Math.min(ratio(l, ring.max), ratio(l, ring.min));
    const base0 = ratio(l, BASE_L);
    report.push(`${tag}\t${label}\tfill ${color}\tnearest ring L ${Math.min(ring.max, ring.min).toFixed(4)}\tcontrast ${worst.toFixed(2)}:1\tbaseline on #0a0a0a ${base0.toFixed(2)}:1`);
    ok(worst >= base0 - 0.2, `[${tag}] ${label} separates from image ${f(worst)}:1 vs ${f(base0)}:1 baseline`);
  }

  console.log(`INFO  [${tag}] error state shows: "${errText}"`);
  await ctx.close();
}

// Repo convention wants a video with visual changes, so record one real
// sign-in run over the new background.
rmSync('/tmp/opencode/.auth-bg-video', { recursive: true, force: true });
const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: '/tmp/opencode/.auth-bg-video', size: { width: 1440, height: 900 } } });
const vpage = await vctx.newPage();
await vpage.goto(`${base}/screens/02-sign-in.html`, { waitUntil: 'load' });
await vpage.fill('#in-email', 'wrong@example.com');
await vpage.fill('#in-password', 'not-the-password');
await vpage.click('#btn-signin');
await vpage.waitForFunction(() => document.querySelector('#in-error').textContent.trim().length > 0);
await vpage.waitForTimeout(700);
const video = vpage.video();
await vctx.close();
copyFileSync(await video.path(), `${out}/sign-in-flow.webm`);
await browser.close();

writeFileSync(`${out}/contrast.txt`, report.join('\n') + '\n');
console.log(failures ? `\n${failures} FAIL` : '\nALL PASS');
process.exit(failures ? 1 : 0);
