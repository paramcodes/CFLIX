import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:3103';
const outDir = new URL('.', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const results = [];
const check = (name, ok, detail) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`); };

const settle = async () => {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('.avatar-tile__pic')].map((el) => {
      const m = getComputedStyle(el).backgroundImage.match(/url\("?([^")]+)"?\)/);
      if (!m) return null;
      const img = new Image();
      img.src = m[1];
      return img.decode();
    }));
  });
  await page.waitForTimeout(250);
};

const readTiles = () => page.$$eval('#profile-list .avatar-tile[data-id]', (els) =>
  els.map((el) => {
    const pic = el.querySelector('.avatar-tile__pic');
    const cs = getComputedStyle(pic);
    return { name: el.textContent.trim(), cls: pic.className, style: pic.getAttribute('style'), bg: cs.backgroundImage, filter: cs.filter };
  }));

const email = `avatar-${Date.now()}@example.com`;
await page.goto(`${base}/screens/02-sign-in.html`);
await page.fill('#in-email', email);
await page.fill('#in-password', 'pw123456');
await page.click('#btn-signup');
await page.waitForURL('**/profiles.html');
check('signed up fresh account', page.url().endsWith('/profiles.html'), `${email} -> ${page.url()}`);

for (let n = 1; n <= 3; n++) {
  await page.click('#add-profile');
  await page.fill('#dlg-name', `Profile ${n}`);
  await page.click('#dlg-create');
  await page.waitForFunction((count) => document.querySelectorAll('#profile-list .avatar-tile[data-id]').length === count, n);
}
check('three profiles created', true, 'Profile 1, Profile 2, Profile 3');

await settle();
const before = await readTiles();
await page.mouse.move(0, 0);
const shot1 = await page.screenshot({ path: `${outDir}profiles-3.png`, fullPage: true });
const shotSame = await page.screenshot({ fullPage: true });

await page.reload();
await page.waitForSelector('#profile-list .avatar-tile[data-id]');
await page.waitForFunction(() => document.querySelectorAll('#profile-list .avatar-tile[data-id]').length >= 3);
await settle();
await page.mouse.move(0, 0);
const after = await readTiles();
const shot2 = await page.screenshot({ path: `${outDir}profiles-3-after-reload.png`, fullPage: true });

check('three profile tiles rendered', before.length >= 3, `${before.length} profile tiles (+ Add)`);
check('first tile is untreated', before[0].style === '' && !before[0].cls.includes('--tint') && before[0].filter === 'none',
  `tile 1 style="${before[0].style}" class="${before[0].cls}" filter=${before[0].filter}`);
check('later tiles carry a tint', before.slice(1).every((t) => t.style && t.style.includes('--tint-a')),
  before.slice(1).map((t) => t.style).join(' | '));
check('later tiles differ from the first', before.slice(1).every((t) => t.bg !== before[0].bg),
  `tile 1 bg differs from ${before.slice(1).length} tinted tiles`);
check('later tiles differ from each other', before[1].bg !== before[2].bg && before[1].style !== before[2].style,
  `tile 2 ${before[1].style} vs tile 3 ${before[2].style}`);

const stable = before.every((t, i) => t.style === after[i].style && t.bg === after[i].bg && t.cls === after[i].cls);
check('per-profile look stable across reload', stable, JSON.stringify(after.map((t) => [t.name, t.style])));
check('screenshot pipeline is deterministic', shot1.equals(shotSame), `back-to-back pngs ${shot1.length} vs ${shotSame.length} bytes`);
check('page pixels identical after reload', shot1.equals(shot2), `png bytes ${shot1.length} vs ${shot2.length}`);

const addPic = await page.$('#add-profile .avatar-tile__pic');
const addStyle = await addPic.getAttribute('style');
const addBg = await addPic.evaluate((el) => getComputedStyle(el).backgroundColor);
check('Add tile untouched', !addStyle && addBg === 'rgb(51, 51, 51)', `style=${addStyle} background=${addBg}`);

const secondTile = '#profile-list .avatar-tile[data-id]:nth-of-type(2)';
await page.mouse.move(0, 0);
await page.hover(secondTile);
await page.waitForTimeout(250);
const ring = await page.$eval(`${secondTile} .avatar-tile__pic`, (el) => getComputedStyle(el).boxShadow);
const rect = await page.$eval(`${secondTile} .avatar-tile__pic`, (el) => { const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }); });
check('hover ring preserved', ring.includes('255, 255, 255'), `${ring} at tile2 rect ${rect}`);
await page.screenshot({ path: `${outDir}profiles-hover.png`, fullPage: true });

await page.mouse.move(0, 0);
await page.click('#profile-list .avatar-tile[data-id]');
await page.waitForURL('**/05-home-page.html');
await page.waitForSelector('#who');
const who = await page.textContent('#who');
check('wire.js still drives the home screen', who.trim().startsWith('Watching as'), who.trim());

await browser.close();
writeFileSync(`${outDir}verify.txt`, results.join('\n') + '\n');
console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
