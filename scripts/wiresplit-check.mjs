import { chromium } from 'playwright';

const B = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3194}`;
const EMAIL = `wiresplit-${Date.now()}@test.dev`;
const PASSWORD = 'pw123456';
const PROFILE = 'Kid';

let failures = 0;
const rows = [];
function check(name, cond, detail = '') {
  rows.push(`${cond ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
  console.log(rows.at(-1));
  if (!cond) failures++;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  window.__rejections = [];
  window.addEventListener('unhandledrejection', (e) => {
    window.__rejections.push(String(e.reason));
  });
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`exception: ${e}`));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() !== 'error') return;
  if (text.includes('Failed to load resource')) return;
  pageErrors.push(`console: ${text}`);
});

const ses = (key) => page.evaluate((k) => sessionStorage.getItem(k), key);
const pageKey = () => page.evaluate(() => document.body.dataset.page);
const cards = (sel) => page.locator(sel).count();
const text = (sel) => page.locator(sel).first().innerText();

await page.goto(`${B}/signin`);
check(
  'signin dispatches on data-page=sign-in',
  (await pageKey()) === 'sign-in',
  await pageKey(),
);
for (const sel of ['#in-email', '#in-password', '#btn-signin', '#btn-signup', '#btn-google', '#in-error']) {
  check(`signin exposes ${sel}`, (await cards(sel)) === 1, `count=${await cards(sel)}`);
}

await page.fill('#in-email', EMAIL);
await page.fill('#in-password', PASSWORD);
await page.fill('#in-password', 'wrong');
await page.click('#btn-signin');
await page.waitForFunction(() => document.querySelector('#in-error').textContent.length > 0);
check(
  'bad password shows inline #in-error and stays on /signin',
  (await text('#in-error')).length > 0 && new URL(page.url()).pathname === '/signin',
  `#in-error="${await text('#in-error')}" url=${new URL(page.url()).pathname}`,
);

await page.fill('#in-password', PASSWORD);
await page.click('#btn-signup');
await page.waitForURL('**/profiles');
check('signup redirects to /profiles', new URL(page.url()).pathname === '/profiles', page.url());
const token = await ses('cflix_token');
check('signup sets sessionStorage.cflix_token', !!token, `cflix_token=${token ? 'set' : 'null'}`);
check(
  'signup clears sessionStorage.cflix_profile',
  (await ses('cflix_profile')) === null,
  `cflix_profile=${await ses('cflix_profile')}`,
);

await page.goto(`${B}/signin`);
await page.fill('#in-email', EMAIL);
await page.fill('#in-password', PASSWORD);
await page.click('#btn-signin');
await page.waitForURL('**/profiles');
check('valid sign-in redirects to /profiles', new URL(page.url()).pathname === '/profiles', page.url());
check('valid sign-in sets cflix_token', !!(await ses('cflix_token')), `cflix_token=${(await ses('cflix_token')) ? 'set' : 'null'}`);

const google = await context.newPage();
await google.goto(`${B}/signin`);
google.once('dialog', (d) => d.accept('google@stub.dev'));
await google.click('#btn-google');
await google.waitForURL('**/profiles');
check(
  '#btn-google prompt stub redirects to /profiles with a token',
  new URL(google.url()).pathname === '/profiles' &&
    !!(await google.evaluate(() => sessionStorage.getItem('cflix_token'))),
  google.url(),
);
await google.close();

check(
  'profiles dispatches on data-page=profiles',
  (await pageKey()) === 'profiles',
  await pageKey(),
);
await page.waitForSelector('#add-profile');
check(
  'fresh account renders only #add-profile',
  (await cards('#profile-list .avatar-tile[data-id]')) === 0 &&
    (await cards('#add-profile')) === 1,
  `tiles=${await cards('#profile-list .avatar-tile[data-id]')} add=${await cards('#add-profile')}`,
);

await page.click('#add-profile');
await page.waitForSelector('#dlg-add.is-open');
await page.fill('#dlg-name', '');
await page.click('#dlg-create');
await page.waitForFunction(() => document.querySelector('#dlg-error').textContent.length > 0);
check(
  'empty #dlg-name blocks create with "Name is required."',
  (await text('#dlg-error')) === 'Name is required.' &&
    (await cards('#profile-list .avatar-tile[data-id]')) === 0,
  `#dlg-error="${await text('#dlg-error')}" tiles=${await cards('#profile-list .avatar-tile[data-id]')}`,
);
await page.click('#dlg-cancel');
await page.waitForSelector('#dlg-add', { state: 'hidden' });

await page.click('#add-profile');
await page.waitForSelector('#dlg-add.is-open');
await page.fill('#dlg-name', PROFILE);
await page.click('#dlg-maturity button[data-m="adult"]');
check(
  'maturity segment marks the clicked button active',
  (await page.getAttribute('#dlg-maturity button[data-m="adult"]', 'class')).includes('is-active'),
  await page.getAttribute('#dlg-maturity button[data-m="adult"]', 'class'),
);
await page.click('#dlg-create');
await page.waitForSelector('#dlg-add', { state: 'hidden' });
await page.waitForFunction(
  () => document.querySelectorAll('#profile-list .avatar-tile[data-id]').length === 1,
);
check(
  'created tile reads "Kid · adult"',
  (await text('#profile-list .avatar-tile[data-id]')).trim() === `${PROFILE} · adult`,
  `tile="${(await text('#profile-list .avatar-tile[data-id]')).trim()}"`,
);

await page.click('#profile-list .avatar-tile[data-id]');
await page.waitForURL('**/home');
check('tile select lands on /home', new URL(page.url()).pathname === '/home', page.url());
check(
  'home dispatches on data-page=home',
  (await pageKey()) === 'home',
  await pageKey(),
);
await page.waitForFunction(() => document.querySelector('#who').textContent.length > 0);
check(
  '#who reads "Watching as Kid"',
  (await text('#who')).trim() === `Watching as ${PROFILE}`,
  `#who="${(await text('#who')).trim()}"`,
);
const stored = JSON.parse((await ses('cflix_profile')) || 'null');
check(
  'select stores cflix_profile {id, name}',
  stored?.name === PROFILE && typeof stored?.id === 'string',
  `cflix_profile=${JSON.stringify(stored)}`,
);

await page.waitForFunction(
  () => document.querySelectorAll('#row-movies .card').length > 0,
);
check('#row-movies has cards', (await cards('#row-movies .card')) > 0, `count=${await cards('#row-movies .card')}`);
check('#row-series has cards', (await cards('#row-series .card')) > 0, `count=${await cards('#row-series .card')}`);

await page.fill('#search-input', 'dark');
await page.click('#search-form button');
await page.waitForFunction(() => document.querySelectorAll('#row-results .card').length > 0);
check(
  'search "dark" returns 2 cards in #row-results',
  (await cards('#row-results .card')) === 2,
  `count=${await cards('#row-results .card')} titles=${JSON.stringify(await page.locator('#row-results .card__title').allInnerTexts())}`,
);
check(
  '#row-results-wrap becomes visible',
  await page.locator('#row-results-wrap').isVisible(),
  `display=${await page.getAttribute('#row-results-wrap', 'style')}`,
);

await page.click('#row-movies .card');
await page.waitForURL('**/title?id=*');
check(
  'movie card opens /title?id=',
  new URL(page.url()).pathname === '/title' && new URL(page.url()).searchParams.get('id') !== null,
  page.url(),
);
check(
  'detail dispatches on data-page=detail',
  (await pageKey()) === 'detail',
  await pageKey(),
);
await page.waitForFunction(
  () => document.querySelector('.detail__artwork span').textContent.length > 0,
);
const movieTitle = (await text('.detail__artwork span')).trim();
check('.detail__artwork span shows the movie title', movieTitle.length > 0, `title="${movieTitle}"`);
check('document.title matches the movie title', (await page.title()) === movieTitle, await page.title());

await page.goto(`${B}/home`);
await page.waitForFunction(() => document.querySelectorAll('#row-series .card').length > 0);
await page.click('#row-series .card');
await page.waitForURL('**/title?id=*');
await page.waitForFunction(
  () => document.querySelectorAll('#episodes .episode-link').length > 0,
);
check(
  'series detail lists #episodes .episode-link',
  (await cards('#episodes .episode-link')) > 0,
  `count=${await cards('#episodes .episode-link')} first="${(await text('#episodes .episode-link')).trim()}"`,
);

await page.click('#btn-play');
await page.waitForURL('**/watch');
check('#btn-play lands on /watch', new URL(page.url()).pathname === '/watch', page.url());
check(
  'player dispatches on data-page=player',
  (await pageKey()) === 'player',
  await pageKey(),
);
await page.waitForFunction(
  () => sessionStorage.getItem('cflix_play_ref') === null,
);
check('player consumes cflix_play_ref', (await ses('cflix_play_ref')) === null, `cflix_play_ref=${await ses('cflix_play_ref')}`);
const playTitle = (await text('.player__title')).trim();
check('.player__title shows the resolved item', playTitle.length > 0, `title="${playTitle}"`);

const elapsedAt = async () => (await text('.player__elapsed')).trim();
const before = await elapsedAt();
await page.waitForTimeout(12000);
const after = await elapsedAt();
check(
  '.player__elapsed advances while playing',
  before !== after,
  `${before} -> ${after}`,
);
const history = await page.evaluate(async () => {
  const r = await fetch('/api/history', {
    headers: {
      authorization: `Bearer ${sessionStorage.getItem('cflix_token')}`,
      'x-cflix-profile': JSON.parse(sessionStorage.getItem('cflix_profile')).id,
    },
  });
  return r.json();
});
check(
  'progress reached GET /api/history with seconds > 0',
  history.items.some((h) => h.seconds > 0),
  `history=${JSON.stringify(history.items)}`,
);

await page.click('#btn-finish');
await page.waitForURL('**/home');
await page.waitForFunction(() => document.querySelector('#who').textContent.length > 0);
check(
  '#btn-finish returns to /home with #who intact',
  new URL(page.url()).pathname === '/home' && (await text('#who')).trim() === `Watching as ${PROFILE}`,
  `url=${new URL(page.url()).pathname} #who="${(await text('#who')).trim()}"`,
);

await page.click('#btn-switch');
await page.waitForURL('**/profiles');
check(
  '#btn-switch clears cflix_profile and returns to /profiles',
  (await ses('cflix_profile')) === null,
  `cflix_profile=${await ses('cflix_profile')}`,
);

const guard = await context.newPage();
await guard.goto(`${B}/signin`);
await guard.evaluate(
  ([t, p]) => {
    sessionStorage.setItem('cflix_token', t);
    sessionStorage.setItem('cflix_profile', p);
  },
  [token, JSON.stringify(stored)],
);
await guard.goto(`${B}/watch`);
await guard.waitForURL('**/home');
check(
  'guard: /watch without cflix_play_ref redirects to /home',
  new URL(guard.url()).pathname === '/home',
  guard.url(),
);
await guard.goto(`${B}/title`);
await guard.waitForURL('**/home');
check(
  'guard: /title without ?id= redirects to /home',
  new URL(guard.url()).pathname === '/home',
  guard.url(),
);
await guard.evaluate(() => sessionStorage.removeItem('cflix_profile'));
await guard.goto(`${B}/home`);
await guard.waitForURL('**/profiles');
check(
  'guard: /home without cflix_profile redirects to /profiles',
  new URL(guard.url()).pathname === '/profiles',
  guard.url(),
);
await guard.evaluate(
  (p) => sessionStorage.setItem('cflix_profile', p),
  JSON.stringify(stored),
);
await guard.goto(`${B}/home`);
await guard.waitForFunction(() => document.querySelector('#who').textContent.length > 0);
check(
  'guard: a seeded cflix_token + cflix_profile reach a rendered /home',
  (await guard.locator('#who').innerText()).trim() === `Watching as ${PROFILE}`,
  `#who="${(await guard.locator('#who').innerText()).trim()}"`,
);
await guard.close();

const rejections = await page.evaluate(() => window.__rejections || []);
check(
  'no uncaught page errors during the run',
  pageErrors.length === 0,
  JSON.stringify(pageErrors),
);
check(
  'no unhandled promise rejections during the run',
  rejections.length === 0,
  JSON.stringify(rejections),
);

await browser.close();
console.log('---');
console.log(`${rows.length - failures}/${rows.length} assertions passed`);
console.log(failures ? 'WIRESPLIT CHECK FAILED' : 'WIRESPLIT CHECK PASSED');
process.exit(failures ? 1 : 0);
