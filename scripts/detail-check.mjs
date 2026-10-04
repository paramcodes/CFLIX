import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const B =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 3294}`;
const SHOTS = 'artifacts/verify-cflix';
const SERIES = 'tt1844624';
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const notes = [];
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
  if (!cond) failures++;
}
function note(line) {
  notes.push(line);
  console.log(`NOTE  ${line}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await context.addInitScript(() => {
  window.__rejections = [];
  window.addEventListener('unhandledrejection', (e) =>
    window.__rejections.push(String(e.reason)),
  );
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`exception: ${e}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (m.text().includes('Failed to load resource')) return;
  pageErrors.push(`console: ${m.text()}`);
});

async function imageOk(url) {
  return page.evaluate(
    (u) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = u;
      }),
    url,
  );
}

const shot = (name) =>
  page.screenshot({ path: `${SHOTS}/detail-${name}.png`, fullPage: true });
const inner = (sel) => page.locator(sel).first().innerText();
const count = (sel) => page.locator(sel).count();
const text = async (sel) => (await inner(sel)).replace(/\s+/g, ' ').trim();
const api = (path, init = {}) =>
  page.evaluate(
    async ([p, body]) => {
      const res = await fetch(p, {
        method: body ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sessionStorage.getItem('cflix_token')}`,
          'x-cflix-profile': JSON.parse(sessionStorage.getItem('cflix_profile'))
            .id,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    },
    [path, init.body ?? null],
  );
const titleReady = () =>
  page.waitForFunction(
    () => document.getElementById('detail-title').textContent.length > 0,
  );

await page.goto(`${B}/signin`);
await page.fill('#in-email', `detail-${Date.now()}@test.dev`);
await page.fill('#in-password', 'pw123456');
await page.click('#btn-signup');
await page.waitForURL('**/profiles');
await page.click('#add-profile');
await page.waitForSelector('#dlg-add.is-open');
await page.fill('#dlg-name', 'Grownup');
await page.click('#dlg-maturity button[data-m="adult"]');
await page.click('#dlg-create');
await page.click('#profile-list .avatar-tile[data-id]');
await page.waitForURL('**/home');
check(
  'signed in and landed on /home',
  new URL(page.url()).pathname === '/home',
  page.url(),
);

/* ------------------------------------------------ a real movie */
const browse = (await api('/api/catalog/browse?kind=movie')).body.items;
let movie = null;
for (const candidate of browse) {
  if (candidate.rating == null || !candidate.logoUrl) continue;
  if (await imageOk(candidate.logoUrl)) {
    movie = candidate;
    break;
  }
}
if (!movie)
  throw new Error(
    'no movie in the catalog carries a rating and a loadable wordmark',
  );
const movieFull = (await api(`/api/catalog/get?id=${movie.id}`)).body;
const expectMatch = `${Math.round(movieFull.rating * 10)}% Match`;
const expectYear = String(movieFull.year);
const expectRuntime = (seconds) => {
  const mins = Math.round((Number(seconds) || 0) / 60);
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
};
const expectRun = expectRuntime(movieFull.durationSeconds);

await page.goto(`${B}/title?id=${movie.id}`);
await titleReady();
await page.waitForFunction(
  () => document.getElementById('detail-logo').complete,
  null,
  { timeout: 20000 },
);
await page.waitForTimeout(400);

check(
  '.detail__artwork span carries the title',
  (await text('#detail-title')).length > 0,
  `title="${await text('#detail-title')}"`,
);
check(
  'document.title matches the rendered title',
  (await page.title()) === movieFull.title,
  await page.title(),
);
const backdrop = await page.evaluate(
  () =>
    getComputedStyle(document.getElementById('detail-backdrop'))
      .backgroundImage,
);
check(
  'the hero backdrop stacks the photo over the fallback gradient',
  backdrop.includes(`url("${movieFull.backdropUrl}")`) &&
    backdrop.split('linear-gradient').length === 2,
  backdrop,
);
check(
  'the provider backdropUrl is a real image',
  await imageOk(movieFull.backdropUrl),
  movieFull.backdropUrl,
);
const heroWithPhoto = await page.locator('.detail__hero').screenshot();
await page.evaluate(() =>
  document
    .getElementById('detail-backdrop')
    .style.setProperty('--photo', 'none'),
);
const heroWithoutPhoto = await page.locator('.detail__hero').screenshot();
check(
  'the backdrop photo actually paints into the hero pixels',
  !heroWithPhoto.equals(heroWithoutPhoto),
  `bytesWithPhoto=${heroWithPhoto.length} bytesWithout=${heroWithoutPhoto.length} identical=${heroWithPhoto.equals(heroWithoutPhoto)}`,
);
await page.reload();
await titleReady();
await page.waitForFunction(
  () => document.getElementById('detail-logo').complete,
  null,
  { timeout: 20000 },
);
check(
  'the provider wordmark loads and stands in for the text title',
  await page.evaluate(() => {
    const img = document.getElementById('detail-logo');
    return (
      !img.hidden &&
      img.naturalWidth > 0 &&
      document.getElementById('detail-heading').classList.contains('detail__sr')
    );
  }),
  await page.evaluate(() => {
    const img = document.getElementById('detail-logo');
    return `hidden=${img.hidden} naturalWidth=${img.naturalWidth} headingSrOnly=${document.getElementById('detail-heading').classList.contains('detail__sr')} src=${img.src}`;
  }),
);

const meta = await text('#detail-metarow');
const parts = meta.split(' · ');
check(
  'the meta row reads match, year, runtime, HD, maturity with a dot between each',
  JSON.stringify(parts) ===
    JSON.stringify([expectMatch, expectYear, expectRun, 'HD', 'Mature']),
  `"${meta}"`,
);
check(
  'the HD badge uses the shared component class',
  (await count('#detail-metarow .badge-quality')) === 1,
  '',
);
check(
  'the maturity badge uses the shared component class',
  (await count('#detail-metarow .badge-maturity')) === 1,
  `"${await text('#detail-metarow .badge-maturity')}"`,
);
check(
  'the synopsis came from the API',
  (await text('#detail-synopsis')) ===
    movieFull.synopsis.replace(/\s+/g, ' ').trim(),
  `${(await text('#detail-synopsis')).slice(0, 58)}...`,
);
check(
  'genres are listed',
  (await text('#detail-facts')).includes(movieFull.genres.join(', ')),
  movieFull.genres.join(', '),
);
check(
  'cast names are listed as plain names, no headshots',
  (await text('#detail-facts')).includes(movieFull.cast.join(', ')) &&
    (await count('#detail-facts img')) === 0,
  movieFull.cast.join(', '),
);
check(
  'no episode picker for a movie',
  await page.locator('#episodes-wrap').isHidden(),
  `hidden=${await page.locator('#episodes-wrap').isHidden()}`,
);
check(
  'More Like This rendered real cards',
  (await count('#row-related .card')) > 0,
  `count=${await count('#row-related .card')}`,
);
const blurred = await page.evaluate(() => {
  const n = [...document.querySelectorAll('*')].find((e) =>
    getComputedStyle(e).filter.includes('blur'),
  );
  return n
    ? `${n.tagName}.${n.className} filter=${getComputedStyle(n).filter}`
    : '';
});
check(
  'no blur filter survives anywhere on the page',
  blurred === '',
  blurred || 'none found',
);
await shot('01-movie');

/* ------------------------------------------------ the three inert actions */
await page.click('button[data-soon="My List"]', { force: true });
check(
  'My List announces itself instead of doing nothing',
  (await text('#detail-soon')).includes('My List'),
  `"${await text('#detail-soon')}"`,
);
check(
  'My List carries aria-disabled and a coming-soon title',
  (await page.getAttribute('button[data-soon="My List"]', 'aria-disabled')) ===
    'true' &&
    (await page.getAttribute('button[data-soon="My List"]', 'title')) ===
      'Coming soon',
  `aria-disabled=${await page.getAttribute('button[data-soon="My List"]', 'aria-disabled')} title=${await page.getAttribute('button[data-soon="My List"]', 'title')}`,
);

/* ------------------------------------------------ a real series, several seasons */
const series = (await api(`/api/catalog/get?id=${SERIES}`)).body;
const seasons = [...new Set(series.episodes.map((e) => e.seasonNumber))].sort(
  (a, b) => a - b,
);
const firstSeason = series.episodes.filter(
  (e) => e.seasonNumber === seasons[0],
);
const lastSeason = series.episodes.filter(
  (e) => e.seasonNumber === seasons.at(-1),
);

let brokenStill = null;
for (const e of lastSeason) {
  if (e.stillUrl && !(await imageOk(e.stillUrl))) {
    brokenStill = e;
    break;
  }
}
note(
  brokenStill
    ? `episode ${brokenStill.id} has stillUrl=${brokenStill.stillUrl} which fails to load; that row is the gradient-fallback proof`
    : `no episode still in season ${seasons.at(-1)} failed to load`,
);

const resumeTarget = firstSeason[2];
const resumeSeconds = Math.round(resumeTarget.durationSeconds * 0.25);
await api('/api/progress', {
  body: { itemId: resumeTarget.id, seconds: resumeSeconds },
});

await page.goto(`${B}/title?id=${SERIES}`);
await page.waitForFunction(
  () => document.querySelectorAll('#episodes .episode-link').length > 0,
);
await page.waitForFunction(
  () => {
    const imgs = [...document.querySelectorAll('#episodes .ep__still')];
    return imgs.length > 0 && imgs.every((i) => i.complete);
  },
  null,
  { timeout: 60000 },
);
await page.waitForTimeout(300);

const resumeOnLoad = await page.evaluate(() => {
  const bar = document.querySelector('#episodes .ep__progress');
  if (!bar) return null;
  const row = bar.closest('.episode-link');
  return {
    ep: row.dataset.ep,
    width: bar.querySelector('i').style.width,
    caption: row.querySelector('.ep__resume').textContent.trim(),
  };
});
check(
  'an episode with progress gets a resume bar sized from the real seconds',
  resumeOnLoad &&
    resumeOnLoad.ep === resumeTarget.id &&
    resumeOnLoad.width === '25%' &&
    resumeOnLoad.caption ===
      `Resume · 25% watched · ${expectRuntime(resumeTarget.durationSeconds - resumeSeconds)} left`,
  `expected ${resumeTarget.id} at ${resumeSeconds}s of ${resumeTarget.durationSeconds}s, got ${JSON.stringify(resumeOnLoad)}`,
);
check(
  'only the episode with progress gets a bar',
  (await count('#episodes .ep__progress')) === 1,
  `bars=${await count('#episodes .ep__progress')} of ${await count('#episodes .episode-link')} rows`,
);
await shot('02-series-with-resume-bar');

const picker = await page.locator('#detail-seasons button').allInnerTexts();
check(
  'the season selector lists exactly the distinct seasons present',
  picker.join(',') === seasons.map((n) => `Season ${n}`).join(','),
  `rendered=${picker.length} expected=${seasons.length} first="${picker[0]}" last="${picker.at(-1)}"`,
);
check(
  'the open season is the pressed one',
  (await page.getAttribute(
    `#detail-seasons button[data-season="${seasons[0]}"]`,
    'aria-pressed',
  )) === 'true',
  `season=${seasons[0]}`,
);
check(
  'the open season renders one row per episode',
  (await count('#episodes .episode-link')) === firstSeason.length,
  `count=${await count('#episodes .episode-link')} expected=${firstSeason.length}`,
);
check(
  'a row carries its number, its runtime and its title',
  (await text('#episodes .episode-link .ep__num')) ===
    String(firstSeason[0].episodeNumber) &&
    (await text('#episodes .episode-link .ep__run')) ===
      expectRuntime(firstSeason[0].durationSeconds) &&
    (await text('#episodes .episode-link .ep__name')) === firstSeason[0].title,
  `num=${await text('#episodes .episode-link .ep__num')} run=${await text('#episodes .episode-link .ep__run')} name="${await text('#episodes .episode-link .ep__name')}"`,
);
check(
  'a row carries the episode synopsis',
  (await text('#episodes .episode-link .ep__desc')) ===
    firstSeason[0].synopsis.replace(/\s+/g, ' ').trim(),
  `${(await text('#episodes .episode-link .ep__desc')).slice(0, 50)}...`,
);
const seasonStills = await page.evaluate(() =>
  [...document.querySelectorAll('#episodes .episode-link')].map((a) => ({
    ep: a.dataset.ep,
    loaded: a.querySelector('.ep__still')?.naturalWidth > 0,
    src: a.querySelector('.ep__still')?.src,
  })),
);
check(
  'every episode still in this season loaded as a real image',
  seasonStills.every((s) => s.loaded),
  `loaded=${seasonStills.filter((s) => s.loaded).length}/${seasonStills.length} failed=${JSON.stringify(seasonStills.filter((s) => !s.loaded).map((s) => s.src))}`,
);
await shot('03-series-season-open');

await page.click(`#detail-seasons button[data-season="${seasons.at(-1)}"]`);
await page.waitForFunction(
  (n) =>
    document.querySelector('.detail__ephead')?.textContent === `Season ${n}`,
  seasons.at(-1),
);
check(
  'switching season swaps the heading and the row list',
  (await text('.detail__ephead')) === `Season ${seasons.at(-1)}` &&
    (await count('#episodes .episode-link')) === lastSeason.length,
  `"${await text('.detail__ephead')}" count=${await count('#episodes .episode-link')} expected=${lastSeason.length}`,
);
await page.waitForTimeout(2000);
await shot('04-series-last-season');

const fallback = await page.evaluate((ep) => {
  const row = document.querySelector(
    `#episodes .episode-link[data-ep="${ep}"]`,
  );
  if (!row) return null;
  return {
    stillElements: row.querySelectorAll('.ep__still').length,
    gradient: getComputedStyle(row.querySelector('.ph')).backgroundImage,
    thumbVisible:
      row.querySelector('.ep__thumb').getBoundingClientRect().width > 0,
  };
}, brokenStill?.id ?? '');
if (brokenStill) {
  check(
    'the episode whose still 404s shows the gradient in its thumbnail with no img element left',
    fallback !== null &&
      fallback.stillElements === 0 &&
      fallback.thumbVisible &&
      fallback.gradient.startsWith('linear-gradient'),
    JSON.stringify(fallback),
  );
  await shot('05-still-gradient-fallback');
} else {
  note(
    'no episode still in this season returned a failed image, so the gradient fallback was not reachable here',
  );
}

/* ------------------------------------------------ logoUrl null falls back to text */
const kitsu = (
  await api(`/api/catalog/get?id=${encodeURIComponent('kitsu:1555')}`)
).body;
await page.goto(`${B}/title?id=${encodeURIComponent('kitsu:1555')}`);
await titleReady();
await page.waitForTimeout(800);
check(
  'a title whose logoUrl is null renders styled text, not a broken image',
  (await page.locator('#detail-logo').isHidden()) &&
    (await page.evaluate(() =>
      document
        .getElementById('detail-heading')
        .classList.contains('detail__sr'),
    )) === false &&
    (await text('#detail-title')) === kitsu.title &&
    (await text('#detail-metarow')).startsWith(
      `${Math.round(kitsu.rating * 10)}% Match`,
    ),
  `logoHidden=${await page.locator('#detail-logo').isHidden()} title="${await text('#detail-title')}" fontSize=${await page.evaluate(() => getComputedStyle(document.getElementById('detail-title')).fontSize)} meta="${await text('#detail-metarow')}"`,
);
check(
  'a series whose provider returned no episode list says so instead of going blank',
  (await count('#episodes .episode-link')) === 0 &&
    (await text('#episodes')).includes('no episode list'),
  `rows=${await count('#episodes .episode-link')} text="${await text('#episodes')}"`,
);
await shot('06-logo-null-styled-text');

/* ------------------------------------------------ a wordmark that 404s falls back to text */
let brokenLogo = null;
for (const candidate of browse) {
  if (candidate.logoUrl && !(await imageOk(candidate.logoUrl))) {
    brokenLogo = candidate;
    break;
  }
}
if (brokenLogo) {
  note(
    `${brokenLogo.id} "${brokenLogo.title}" carries logoUrl=${brokenLogo.logoUrl} which returns no image, so it is the logo-fallback proof`,
  );
  await page.goto(`${B}/title?id=${brokenLogo.id}`);
  await titleReady();
  await page.waitForFunction(
    () => document.getElementById('detail-logo').complete,
    null,
    {
      timeout: 20000,
    },
  );
  await page.waitForTimeout(400);
  check(
    'a wordmark that fails to load leaves styled text and no broken image',
    (await page.locator('#detail-logo').isHidden()) &&
      (await page.evaluate(() =>
        document
          .getElementById('detail-heading')
          .classList.contains('detail__sr'),
      )) === false &&
      (await text('#detail-title')) === brokenLogo.title,
    `logoHidden=${await page.locator('#detail-logo').isHidden()} headingSrOnly=${await page.evaluate(() => document.getElementById('detail-heading').classList.contains('detail__sr'))} title="${await text('#detail-title')}"`,
  );
  await shot('07-broken-wordmark-falls-back-to-text');
} else {
  note(
    'no logoUrl in the catalog returned a failed image during this run, so the logo-error fallback was not reachable live',
  );
}

/* ------------------------------------------------ no backdrop, fixture source */
await page.goto(`${B}/title?id=m1`);
await titleReady();
const fixtureBackdrop = await page.evaluate(
  () =>
    getComputedStyle(document.getElementById('detail-backdrop'))
      .backgroundImage,
);
check(
  'a title with no backdropUrl falls back to the gradient and declares itself a fixture',
  !fixtureBackdrop.includes('http') &&
    fixtureBackdrop.includes('linear-gradient(160deg') &&
    (await text('#detail-facts')).includes('Offline fixture'),
  `${fixtureBackdrop} | ${(await text('#detail-facts')).slice(0, 100)}`,
);
await shot('08-no-backdrop-fixture');

/* ------------------------------------------------ a title that cannot load */
await page.goto(`${B}/title?id=tt00000000`);
await page.waitForFunction(
  () => document.getElementById('detail-synopsis').textContent.length > 0,
);
check(
  'a title the API refuses renders an honest error instead of throwing',
  (await text('#detail-synopsis')).includes('could not load'),
  `"${await text('#detail-synopsis')}"`,
);

/* ------------------------------------------------ play routes to /watch with the right item */
await page.goto(`${B}/title?id=${movie.id}`);
await titleReady();
await page.click('#btn-play');
await page.waitForURL('**/watch');
await page.waitForFunction(
  () => sessionStorage.getItem('cflix_play_ref') === null,
);
const playedTitle = await text('.player__title');
check(
  '#btn-play routes to /watch with the clicked movie',
  new URL(page.url()).pathname === '/watch' &&
    playedTitle === movieFull.title.trim(),
  `url=${new URL(page.url()).pathname} player=${JSON.stringify(playedTitle)} expected=${JSON.stringify(movieFull.title.trim())}`,
);
await shot('09-watch-after-play');

/* ------------------------------------------------ an episode row routes to /watch */
await page.goto(`${B}/title?id=s1`);
await page.waitForFunction(
  () => document.querySelectorAll('#episodes .episode-link').length > 0,
);
check(
  'the fixture series derives its seasons from seasons[].episodes[]',
  (await count('#detail-seasons button')) === 2,
  `count=${await count('#detail-seasons button')}`,
);
await page.click('#episodes .episode-link[data-ep="s1e2"]');
await page.waitForURL('**/watch');
await page.waitForFunction(
  () => sessionStorage.getItem('cflix_play_ref') === null,
);
check(
  'an episode row routes to /watch with that episode',
  (await text('.player__title')) === 'Lies',
  `player=${JSON.stringify(await text('.player__title'))} for data-ep=s1e2, which the fixture titles "Lies"`,
);

const providerRef = await api('/api/play', {
  body: { ref: { kind: 'episode', id: `${SERIES}:1:3` } },
});
note(
  `server /api/play with the provider episode ref {kind:'episode', id:'${SERIES}:1:3'} returned ${providerRef.status} ${JSON.stringify(providerRef.body.error?.code)}; catalog.js EPISODE_ID=/:e\\d+$/ does not match the cinemeta id, which is a server-side defect outside this page's files`,
);

check(
  'no uncaught page errors during the run',
  pageErrors.length === 0,
  JSON.stringify(pageErrors),
);
const rejections = await page.evaluate(() => window.__rejections || []);
check(
  'no unhandled promise rejections during the run',
  rejections.length === 0,
  JSON.stringify(rejections),
);

await browser.close();
console.log('---');
console.log(notes.map((n) => `NOTE ${n}`).join('\n'));
console.log(failures ? 'DETAIL CHECK FAILED' : 'DETAIL CHECK PASSED');
process.exit(failures ? 1 : 0);
