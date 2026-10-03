import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.BASE || 'http://localhost:3104';
const outDir = new URL('.', import.meta.url).pathname;
const url = `${base}/home`;
const viewports = [
  { tag: 'desktop-1440x900', width: 1440, height: 900 },
  { tag: 'wide-1920x1080', width: 1920, height: 1080 },
];

const rectsOf = () => ['hero__kicker', 'hero__title', 'hero__synopsis', 'hero__actions'].map((cls) => {
  const el = document.querySelector(`.${cls}`);
  const r = el.getBoundingClientRect();
  return { name: cls, x: r.x, y: r.y, width: r.width, height: r.height };
});

async function contrast(page, buf, rects) {
  return page.evaluate(async ({ dataUrl, rects }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return rects.map((r) => {
      const x0 = Math.max(0, Math.round(r.x));
      const y0 = Math.max(0, Math.round(r.y));
      const x1 = Math.min(canvas.width, Math.round(r.x + r.width));
      const y1 = Math.min(canvas.height, Math.round(r.y + r.height));
      const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      let sum = 0;
      let max = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const L = 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
        sum += L;
        if (L > max) max = L;
        n += 1;
      }
      const mean = sum / n;
      return {
        region: r.name,
        meanLuminance: +mean.toFixed(4),
        maxLuminance: +max.toFixed(4),
        contrastVsWhiteText_mean: +(1.05 / (mean + 0.05)).toFixed(2),
        contrastVsWhiteText_worstPixel: +(1.05 / (max + 0.05)).toFixed(2),
      };
    });
  }, { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, rects });
}

const signupRes = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `billboard-${Date.now()}@example.test`, password: 'Billboard!2345' }),
});
const { session } = await signupRes.json();
if (!signupRes.ok) throw new Error(`signup ${signupRes.status}: ${JSON.stringify(session)}`);
const auth = { authorization: `Bearer ${session.token}` };
await fetch(`${base}/api/profiles`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Verifier', maturity: 'adult' }),
});
const profileList = await fetch(`${base}/api/profiles`, { headers: auth }).then((r) => r.json());
const profile = { id: profileList.items[0].id, name: profileList.items[0].name };

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const report = [];

for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await context.addInitScript(([token, prof]) => {
    try {
      sessionStorage.setItem('cflix_token', token);
      sessionStorage.setItem('cflix_profile', JSON.stringify(prof));
    } catch {}
  }, [session.token, profile]);
  const page = await context.newPage();
  const asset = { status: null, bytes: 0 };
  page.on('response', async (res) => {
    if (res.url().includes('house-of-ninjas.webp')) {
      asset.status = res.status();
      try {
        asset.bytes = (await res.body()).length;
      } catch {}
    }
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const computed = await page.$eval('.hero__bg--ninja', (el) => getComputedStyle(el).backgroundImage);
  const rects = await page.evaluate(rectsOf);
  const heroBox = await page.locator('.hero').boundingBox();

  await page.screenshot({ type: 'jpeg', quality: 88, path: `${outDir}billboard-${vp.tag}.jpg` });
  await page.locator('.hero').screenshot({ type: 'jpeg', quality: 88, path: `${outDir}billboard-hero-${vp.tag}.jpg` });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: '.hero__inner { visibility: hidden; }' });
  await page.waitForTimeout(150);
  const backdrop = await page.screenshot({ type: 'jpeg', quality: 88, path: `${outDir}billboard-${vp.tag}-backdrop.jpg` });

  const analyzer = await context.newPage();
  await analyzer.goto('about:blank');
  const contrastRows = await contrast(analyzer, backdrop, rects);
  await analyzer.close();

  report.push({
    viewport: vp.tag,
    heroHeight: Math.round(heroBox.height),
    assetHttpStatus: asset.status,
    assetBytes: asset.bytes,
    computedBackgroundImage: computed,
    hasDarkGradientLayer: computed.includes('linear-gradient'),
    hasRealImage: computed.includes('house-of-ninjas.webp'),
    contrast: contrastRows,
  });
  await context.close();
}

await browser.close();

const failed = [];
for (const row of report) {
  if (row.assetHttpStatus !== 200) failed.push(`${row.viewport}: asset HTTP ${row.assetHttpStatus}`);
  if (!row.hasDarkGradientLayer) failed.push(`${row.viewport}: no linear-gradient layer`);
  if (!row.hasRealImage) failed.push(`${row.viewport}: no house-of-ninjas.webp layer`);
  for (const c of row.contrast) {
    if (c.contrastVsWhiteText_mean < 4.5) failed.push(`${row.viewport}: ${c.region} mean contrast ${c.contrastVsWhiteText_mean}`);
    if (c.contrastVsWhiteText_worstPixel < 3) failed.push(`${row.viewport}: ${c.region} brightest-pixel contrast ${c.contrastVsWhiteText_worstPixel}`);
  }
}

console.log(JSON.stringify(report, null, 2));
if (failed.length) {
  console.error('FAIL\n' + failed.map((f) => `  ${f}`).join('\n'));
  process.exit(1);
}
console.log('PASS  image loaded, scrim layer present, every text region mean contrast >= 4.5 and brightest pixel >= 3.0 vs white');
