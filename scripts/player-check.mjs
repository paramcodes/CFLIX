import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const B = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3217}`;
const OUT_DIR = 'artifacts/verify-cflix';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const EMAIL = `player-${Date.now()}@test.dev`;
const PASSWORD = 'pw123456';

mkdirSync(OUT_DIR, { recursive: true });

let failures = 0;
const rows = [];
function check(name, cond, detail = '') {
  const row = `${cond ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`;
  rows.push(row);
  console.log(row);
  if (!cond) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = (s) => {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

async function post(path, body, headers = {}) {
  const res = await fetch(B + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function get(path, headers = {}) {
  const res = await fetch(B + path, { headers });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function until(fn, timeoutMs, everyMs = 300) {
  const started = Date.now();
  let value = await fn();
  while (Date.now() - started < timeoutMs) {
    if (value) return value;
    await sleep(everyMs);
    value = await fn();
  }
  return value;
}

const signup = await post('/api/auth/signup', { email: EMAIL, password: PASSWORD });
const token = signup.data.session?.token;
check('signup returns a token', !!token, `status=${signup.status}`);

const created = await post(
  '/api/profiles',
  { name: 'Player', maturity: 'adult' },
  { authorization: `Bearer ${token}` },
);
const profile = created.data;
check('adult profile created', !!profile.id, JSON.stringify(profile));

const auth = { authorization: `Bearer ${token}`, 'x-cflix-profile': profile.id };
const movies = (await get('/api/catalog/browse?kind=movie', auth)).data.items || [];
const series = (await get('/api/catalog/browse?kind=series', auth)).data.items || [];
const trailerMovie = movies.find((m) => m.trailerYtId);
const trailerSeries = series.find((s) => s.trailerYtId);
const seedMovie = (await get('/api/catalog/get?id=m1', auth)).data;
check('catalog has a movie with a trailer', !!trailerMovie, `${trailerMovie?.id}`);
check('catalog has a series with a trailer', !!trailerSeries, `${trailerSeries?.id}`);
check('seed movie has no trailer', seedMovie?.trailerYtId == null, JSON.stringify(seedMovie?.trailerYtId));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(
  ({ t, p }) => {
    sessionStorage.setItem('cflix_token', t);
    sessionStorage.setItem('cflix_profile', p);
    const stored = sessionStorage.getItem('__player_rejections');
    window.__rejections = stored ? JSON.parse(stored) : [];
    window.addEventListener('unhandledrejection', (e) => {
      window.__rejections.push(String(e.reason));
      sessionStorage.setItem('__player_rejections', JSON.stringify(window.__rejections));
    });
  },
  { t: token, p: JSON.stringify(profile) },
);

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`exception: ${e}`));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() !== 'error') return;
  if (text.includes('Failed to load resource')) return;
  pageErrors.push(`console: ${text}`);
});

const text = (selector) => page.locator(selector).first().innerText();
const attr = (selector, name) => page.locator(selector).first().getAttribute(name);
const value = (selector) => page.locator(selector).first().inputValue();
const disabled = (selector) => page.locator(selector).first().isDisabled();
const ytInfo = () =>
  page.evaluate(() => {
    const player = window.YT?.get?.('yt-player');
    if (!player || typeof player.getPlayerState !== 'function') return null;
    return {
      state: player.getPlayerState(),
      duration: player.getDuration(),
      current: player.getCurrentTime(),
      buffered: player.getVideoLoadedFraction(),
      muted: player.isMuted(),
      volume: player.getVolume(),
    };
  });

async function openWatch(ref) {
  await page.goto(`${B}/home`);
  await page.evaluate((r) => sessionStorage.setItem('cflix_play_ref', JSON.stringify(r)), ref);
  await page.goto(`${B}/watch`);
  await page.waitForFunction(
    () => document.querySelector('.player__title').textContent.trim().length > 0,
    null,
    { timeout: 20000 },
  );
}

check('server enforces auth', (await get('/api/profiles')).status === 401, 'unauthenticated read');

const startedAt = Date.now();
await openWatch({ kind: 'movie', id: trailerMovie.id });
const titleAt = Date.now() - startedAt;

check(
  '.player__title shows the resolved movie title',
  (await text('.player__title')).trim() === trailerMovie.title,
  `title="${await text('.player__title')}" expected="${trailerMovie.title}" resolved in ${titleAt}ms`,
);

const styleApplied = await page.evaluate(() => ({
  sheets: [...document.styleSheets].map((s) => s.href || ''),
  height: getComputedStyle(document.querySelector('.player')).height,
}));
check(
  'page stylesheet /css/player.css is loaded and applied',
  styleApplied.sheets.some((h) => h.endsWith('/css/player.css')) && styleApplied.height === '900px',
  JSON.stringify(styleApplied),
);

const badge = (await text('#media-badge')).trim();
const note = (await text('#media-note')).trim();
check('trailer badge is shown', badge === 'TRAILER', `badge="${badge}"`);
check(
  'label states this is a trailer, not the full title',
  /Trailer only/.test(note) && /no full-length stream/.test(note),
  `note="${note}"`,
);

const iframeUp = await until(async () => (await page.locator('.player__frame iframe').count()) === 1, 15000);
const iframeCount = await page.locator('.player__frame iframe').count();
check('real media element (youtube iframe) is present', !!iframeUp && iframeCount === 1, `iframes=${iframeCount}`);

const reported = await until(async () => {
  const info = await ytInfo();
  return info && info.duration > 0 ? info : null;
}, 20000);
const readyAt = Date.now() - startedAt;
check(
  'media element reports a duration',
  !!reported && reported.duration > 0,
  `${JSON.stringify(reported)} ready ${readyAt}ms after /watch`,
);
check(
  'transport total is not 0:00:00',
  !/^0:00:00 \/ 0:00:00$/.test((await text('#time')).trim()),
  `#time="${await text('#time')}"`,
);

const first = await text('#elapsed');
const advanced = await until(async () => (await text('#elapsed')) !== first, 12000, 500);
check('.player__elapsed advances from real playback', !!advanced, `${first} -> ${await text('#elapsed')}`);

const playingLabel = await attr('#btn-toggle', 'aria-label');
check('play button reads Pause while playing', playingLabel === 'Pause', `aria-label=${playingLabel}`);
await page.click('#btn-toggle');
const paused = await until(async () => (await ytInfo())?.state === 2, 5000);
check('clicking the control pauses real playback', !!paused, JSON.stringify(await ytInfo()));
check(
  'play button reads Play while paused',
  (await attr('#btn-toggle', 'aria-label')) === 'Play',
  `aria-label=${await attr('#btn-toggle', 'aria-label')}`,
);
await page.click('#btn-toggle');
const resumed = await until(async () => (await ytInfo())?.state === 1, 5000);
check('clicking the control resumes playback', !!resumed, JSON.stringify(await ytInfo()));

const history = await until(async () => {
  const { data } = await get('/api/history', auth);
  const row = (data.items || []).find((h) => h.itemId === trailerMovie.id);
  return row && row.seconds > 0 ? row : null;
}, 25000, 500);
const nowPlaying = await ytInfo();
check('progress reaches GET /api/history with seconds > 0', !!history, JSON.stringify(history));
check(
  'posted seconds match the media element, not a synthetic counter',
  !!history &&
    history.seconds <= Math.ceil(nowPlaying?.current ?? 0) + 1 &&
    history.seconds < (trailerMovie.durationSeconds || Infinity),
  `seconds=${history?.seconds} currentTime=${nowPlaying?.current} itemDuration=${trailerMovie.durationSeconds}`,
);
writeFileSync(
  `${OUT_DIR}/player-check-history-${stamp}.json`,
  JSON.stringify(
    { itemId: trailerMovie.id, history, currentTime: nowPlaying?.current, buffered: nowPlaying?.buffered },
    null,
    2,
  ),
);

check(
  'scrub bar carries a buffered range',
  !!nowPlaying && nowPlaying.buffered > 0 && nowPlaying.buffered <= 1,
  `bufferedFraction=${nowPlaying?.buffered} barWidth=${await page.locator('.player__buffer').evaluate((el) => el.style.width)}`,
);

const seekBefore = Number(await value('#seek'));
await page.focus('#seek');
await page.keyboard.press('End');
const seekEnd = await until(async () => (await ytInfo())?.current > (reported.duration || 0) - 4, 8000);
check(
  'keyboard End on the scrub bar seeks to the end',
  !!seekEnd && Math.abs(Number(await value('#seek')) - reported.duration) <= 2,
  `value=${await value('#seek')} current=${(await ytInfo())?.current} duration=${reported.duration}`,
);
await page.keyboard.press('Home');
const seekHome = await until(async () => (await ytInfo())?.current < 4, 8000);
check(
  'keyboard Home on the scrub bar seeks to the start',
  !!seekHome && Number(await value('#seek')) < 4,
  `value=${await value('#seek')} current=${(await ytInfo())?.current} before=${seekBefore}`,
);

const seekBeforeArrow = Number(await value('#seek'));
await page.keyboard.press('ArrowRight');
await sleep(700);
const seekAfterArrow = Number(await value('#seek'));
check('keyboard arrow on the scrub bar nudges the position', seekAfterArrow > seekBeforeArrow, `${seekBeforeArrow} -> ${seekAfterArrow}`);

await page.focus('#vol');
const volumeBefore = Number(await value('#vol'));
await page.keyboard.press('ArrowLeft');
const volumeAfter = Number(await value('#vol'));
check('keyboard arrow on the volume slider changes the level', volumeAfter < volumeBefore, `${volumeBefore} -> ${volumeAfter}`);

await page.focus('#btn-mute');
await page.keyboard.press('Enter');
const mutedPressed = await attr('#btn-mute', 'aria-pressed');
check('keyboard Enter on the mute button toggles aria-pressed', mutedPressed === 'true', `aria-pressed=${mutedPressed}`);
await page.keyboard.press('Enter');
check('mute button toggles back', (await attr('#btn-mute', 'aria-pressed')) === 'false', `aria-pressed=${await attr('#btn-mute', 'aria-pressed')}`);

await page.focus('#btn-full');
await page.keyboard.press('Enter');
const fullscreen = await until(async () => page.evaluate(() => !!document.fullscreenElement), 5000);
check('keyboard Enter on the fullscreen button enters fullscreen', !!fullscreen, `fullscreenElement=${await page.evaluate(() => !!document.fullscreenElement)}`);
check('fullscreen button reports aria-pressed', (await attr('#btn-full', 'aria-pressed')) === 'true', `aria-pressed=${await attr('#btn-full', 'aria-pressed')}`);
await page.keyboard.press('Escape');
await until(async () => page.evaluate(() => !document.fullscreenElement), 5000);

await page.keyboard.press('Tab');
const reached = new Set();
const operations = {};
for (let i = 0; i < 40; i++) {
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { id: '', tag: '' };
    return { id: el.id || '', tag: el.tagName.toLowerCase() };
  });
  reached.add(info.id || info.tag);
  if (info.id === 'seek' && !operations.seek) {
    const before = await value('#seek');
    await page.keyboard.press('ArrowRight');
    await sleep(400);
    operations.seek = Number(await value('#seek')) > Number(before);
  }
  if (info.id === 'vol' && !operations.vol) {
    const before = Number(await value('#vol'));
    await page.keyboard.press('ArrowRight');
    operations.vol = Number(await value('#vol')) > before;
  }
  if (info.id === 'btn-toggle' && !operations.toggle) {
    const before = await attr('#btn-toggle', 'aria-label');
    await page.keyboard.press('Enter');
    await sleep(400);
    operations.toggle = (await attr('#btn-toggle', 'aria-label')) !== before;
    await page.keyboard.press('Enter');
    await sleep(300);
  }
  const expected = ['btn-back', 'btn-toggle', 'btn-rew', 'btn-fwd', 'btn-mute', 'vol', 'seek', 'btn-full', 'btn-finish'];
  if (expected.every((id) => reached.has(id))) break;
  await page.keyboard.press('Tab');
}
const expected = ['btn-back', 'btn-toggle', 'btn-rew', 'btn-fwd', 'btn-mute', 'vol', 'seek', 'btn-full', 'btn-finish'];
for (const id of expected) {
  check(`keyboard reaches #${id}`, reached.has(id), `reached=${[...reached].join(',')}`);
}
check('keyboard operates #seek', !!operations.seek, JSON.stringify(operations));
check('keyboard operates #vol', !!operations.vol, JSON.stringify(operations));
check('keyboard operates #btn-toggle', !!operations.toggle, JSON.stringify(operations));

await page.focus('#seek');
await page.screenshot({ path: `${OUT_DIR}/player-trailer-controls-${stamp}.png` });
await page.evaluate(() => document.activeElement.blur());
await page.screenshot({ path: `${OUT_DIR}/player-trailer-${stamp}.png` });

await page.setViewportSize({ width: 375, height: 667 });
await sleep(400);
const narrow = await page.evaluate(() => {
  const box = (selector) => document.querySelector(selector).getBoundingClientRect();
  const stage = box('.player__stage');
  const transport = box('.player__transport');
  const finish = box('#btn-finish');
  return {
    stageBottom: Math.round(stage.bottom),
    transportTop: Math.round(transport.top),
    transportBottom: Math.round(transport.bottom),
    finishTop: Math.round(finish.top),
    viewport: [innerWidth, innerHeight],
  };
});
check(
  'small viewport: controls sit below the media, not over it',
  narrow.transportTop >= narrow.stageBottom - 1 && narrow.finishTop >= narrow.transportBottom - 1,
  JSON.stringify(narrow),
);
await page.screenshot({ path: `${OUT_DIR}/player-small-viewport-${stamp}.png` });
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(300);

await openWatch({ kind: 'movie', id: 'm1' });
const posterBadge = (await text('#media-badge')).trim();
const posterNote = (await text('#media-note')).trim();
check('no-trailer title shows NO PREVIEW badge', posterBadge === 'NO PREVIEW', `badge="${posterBadge}"`);
check(
  'no-trailer label says nothing plays',
  /No trailer for this title/.test(posterNote) && /nothing plays/.test(posterNote),
  `note="${posterNote}"`,
);
check(
  'no trailer means no media element',
  (await page.locator('.player__frame iframe').count()) === 0 && (await page.locator('.player__frame').first().isHidden()),
  `iframes=${await page.locator('.player__frame iframe').count()}`,
);
check(
  'poster still with the .ph--still gradient is visible',
  (await page.locator('.ph--still').first().isVisible()) && (await page.locator('.player__poster').first().isVisible()),
  '',
);
const posterElapsedA = await text('#elapsed');
await sleep(3000);
const posterElapsedB = await text('#elapsed');
check('poster fallback never advances the clock', posterElapsedA === '0:00:00' && posterElapsedB === posterElapsedA, `${posterElapsedA} -> ${posterElapsedB}`);
check(
  'media controls are disabled with nothing to play',
  (await disabled('#btn-toggle')) && (await disabled('#seek')) && (await disabled('#vol')) && (await disabled('#btn-fwd')),
  '',
);
check('back and finish stay operable', !(await disabled('#btn-back')) && !(await disabled('#btn-finish')), '');
check(
  'time shows the title runtime with nothing playing',
  (await text('#time')).trim() === `0:00:00 / ${clock(seedMovie.durationSeconds)}`,
  `#time="${await text('#time')}" expected="0:00:00 / ${clock(seedMovie.durationSeconds)}"`,
);
await page.screenshot({ path: `${OUT_DIR}/player-poster-fallback-${stamp}.png` });

const expectedPlay = await post('/api/play', { ref: { kind: 'series', id: trailerSeries.id } }, auth);
await openWatch({ kind: 'series', id: trailerSeries.id });
const episodeTitle = (await text('.player__title')).trim();
const epnum = (await text('#epnum')).trim();
check(
  'series play resolves to an episode and shows it',
  episodeTitle === expectedPlay.data.item?.title,
  `title="${episodeTitle}" resolved="${expectedPlay.data.item?.title}"`,
);
check(
  'episode label is S#:E#',
  /^S\d+:E\d+$/.test(epnum),
  `epnum="${epnum}" season=${expectedPlay.data.item?.seasonNumber} episode=${expectedPlay.data.item?.episodeNumber}`,
);
const episodeTrailer = await until(async () => (await page.locator('.player__frame iframe').count()) === 1, 15000);
check('episode plays the series trailer', !!episodeTrailer, `iframes=${await page.locator('.player__frame iframe').count()}`);
await sleep(2500);
await page.screenshot({ path: `${OUT_DIR}/player-episode-${stamp}.png` });

await page.click('#btn-finish');
await page.waitForURL('**/home', { timeout: 10000 }).catch(() => {});
check('#btn-finish returns to /home', new URL(page.url()).pathname === '/home', page.url());

const finishHistory = (await get('/api/history', auth)).data.items || [];
const episodeRow = finishHistory.find((h) => h.itemId === expectedPlay.data.item?.id);
check('mark watched records the episode with the cleared position', !!episodeRow && episodeRow.seconds === 0, JSON.stringify(episodeRow));

const rejections = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__player_rejections') || '[]'));
check('no uncaught page errors', pageErrors.length === 0, JSON.stringify(pageErrors));
check('no unhandled promise rejections', rejections.length === 0, JSON.stringify(rejections));

await browser.close();
writeFileSync(`${OUT_DIR}/player-check-${stamp}.log`, rows.join('\n') + '\n');
console.log('---');
console.log(`${rows.length - failures}/${rows.length} assertions passed`);
console.log(failures ? 'PLAYER CHECK FAILED' : 'PLAYER CHECK PASSED');
process.exit(failures ? 1 : 0);
