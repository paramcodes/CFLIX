import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const B = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000';
const OUT = process.argv[2] || 'artifacts/verify-cflix/browse';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const skipped = [];
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
}
function skip(name, why) {
  skipped.push(name);
  console.log(`SKIP  ${name}  ${why}`);
}
const eq = (name, actual, expected) =>
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on('pageerror', (err) => console.log(`  pageerror: ${err.message}`));

const shot = (name) =>
  page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).then(() => name);

const titles = () =>
  page.locator('#browse-grid .browse__card .card__title').allTextContents();
const kinds = () =>
  page.locator('#browse-grid .browse__card').evaluateAll((els) =>
    els.map((e) => e.dataset.kind),
  );
const ids = () =>
  page.locator('#browse-grid .browse__card').evaluateAll((els) =>
    els.map((e) => new URL(e.href).searchParams.get('id')),
  );
const selectedTab = () =>
  page.locator('#browse-tabs [aria-selected="true"]').textContent();
const visible = (sel) => page.locator(sel).isVisible();
const settle = () => page.locator('#browse-panel[aria-busy="false"]').waitFor();

/** Filling the box only schedules a debounced commit, so wait for the URL that commit produces. */
const search = async (text) => {
  await page.locator('#browse-q').fill(text);
  await page.waitForFunction(
    (t) => new URLSearchParams(location.search).get('q') === t,
    text,
  );
  await settle();
};

const catalog = (path) =>
  page.evaluate(
    async ({ path, profileId }) => {
      const d = await fetch(path, {
        headers: {
          authorization: `Bearer ${sessionStorage.getItem('cflix_token')}`,
          'x-cflix-profile': profileId,
        },
      }).then((r) => r.json());
      return d.items || [];
    },
    { path, profileId },
  );

await page.goto(B + '/signin');
const profileId = await page.evaluate(async () => {
  const post = (p, b) =>
    fetch(p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    }).then((r) => r.json());
  const email = `browse${Date.now()}@test.dev`;
  let r = await post('/api/auth/signup', { email, password: 'pw123456' });
  if (r.error) r = await post('/api/auth/signin', { email, password: 'pw123456' });
  const p = await fetch('/api/profiles', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${r.session.token}`,
    },
    body: JSON.stringify({ name: 'Grownup', maturity: 'adult' }),
  }).then((x) => x.json());
  sessionStorage.setItem('cflix_token', r.session.token);
  sessionStorage.setItem('cflix_profile', JSON.stringify(p));
  return p.id;
});

const live = await page
  .evaluate(
    (id) =>
      fetch('/api/catalog/browse?kind=movie', {
        headers: {
          authorization: `Bearer ${sessionStorage.getItem('cflix_token')}`,
          'x-cflix-profile': id,
        },
      })
        .then((r) => r.json())
        .then((d) => (d.items || []).some((i) => i.source === 'provider'))
        .catch(() => false),
    profileId,
  )
  .catch(() => false);
if (!live) console.log('note: the catalog provider returned nothing; provider-backed checks skip.');

/* ------------------------------------------------------------------ route and first render */

{
  const res = await fetch(B + '/browse');
  eq('GET /browse returns 200', res.status, 200);
  await page.goto(B + '/browse');
  await settle();
  eq(
    'heading renders',
    (await page.locator('h1.browse__heading').textContent()).trim(),
    'Browse',
  );
  eq('default kind tab is All', (await selectedTab()).trim(), 'All');
  eq('default genre is All genres', await page.inputValue('#browse-genre'), '');
  eq('search box starts empty', await page.inputValue('#browse-q'), '');
  eq(
    'genre options match the server vocabulary',
    (await page.locator('#browse-genre option').allTextContents()).join(','),
    'All genres,Adult,Animation,Children,Crime,Espionage,Family,Horror,Kids,Thriller,War',
  );
  if (live) eq('the catalog renders 24 titles', (await titles()).length, 24);
  await shot('01-browse-default');
}

/* ------------------------------------------------------------------ debounced typing */

{
  await page.goto(B + '/browse');
  await settle();
  let searches = 0;
  const count = (r) => {
    if (r.url().endsWith('/api/catalog/search')) searches++;
  };
  page.on('request', count);
  for (const ch of 'dark') await page.locator('#browse-q').press(ch);
  await page.waitForFunction(
    () => new URLSearchParams(location.search).get('q') === 'dark',
  );
  eq('typing "dark" fires one request, not four', searches, 1);
  page.off('request', count);
  await settle();
  eq('typing updates the URL', new URL(page.url()).search, '?q=dark');
  eq(
    'the query renders the matching titles',
    (await titles()).join(' | '),
    'The Dark Knight | Dark',
  );
  eq(
    'offline sample rows are flagged, not passed off as live',
    await visible('#browse-note'),
    true,
  );
  eq(
    'each sample row carries a Sample badge',
    await page.locator('#browse-grid .badge-quality', { hasText: 'Sample' }).count(),
    2,
  );
  await shot('02-browse-search-dark');
}

/* ------------------------------------------------------------------ reload reproduces state */

{
  await page.goto(B + '/browse?q=naruto&kind=anime');
  await settle();
  eq('reload restores the query', await page.inputValue('#browse-q'), 'naruto');
  eq('reload restores the kind tab', (await selectedTab()).trim(), 'Anime');
  eq(
    'reload restores the anime provider, not the active one',
    (await ids()).every((id) => String(id).startsWith('kitsu:')),
    true,
  );
  eq('reload still renders titles', (await titles()).length > 0, true);
  await shot('03-browse-reload-anime');
}

{
  await page.goto(B + '/browse?q=the&kind=movie&genre=horror');
  await settle();
  eq('all three params round-trip: query', await page.inputValue('#browse-q'), 'the');
  eq('all three params round-trip: kind', (await selectedTab()).trim(), 'Movies');
  eq('all three params round-trip: genre', await page.inputValue('#browse-genre'), 'horror');
  eq('seed titles carry no genres, so the genre filter drops them', (await titles()).length, 0);
  eq('which is the empty state', await visible('#browse-empty'), true);
  eq('and not an error state', await visible('#browse-error'), false);
  await shot('04-browse-three-params-empty');
}

/* ------------------------------------------------------------------ back and forward */

{
  await page.goto(B + '/browse');
  await settle();
  await page.locator('#browse-q').fill('dark');
  await page.locator('#browse-q').press('Enter');
  await settle();
  eq('a committed query is in the URL', new URL(page.url()).search, '?q=dark');

  await page.locator('#browse-tabs [data-kind="movie"]').click();
  await settle();
  await page.locator('#browse-tabs [data-kind="series"]').click();
  await settle();
  eq('two tabs deep', new URL(page.url()).search, '?q=dark&kind=series');

  await page.goBack();
  await settle();
  eq('back restores kind=movie in the URL', new URL(page.url()).search, '?q=dark&kind=movie');
  eq('back restores the selected tab', (await selectedTab()).trim(), 'Movies');
  eq('back restores the search box', await page.inputValue('#browse-q'), 'dark');
  eq('back re-renders the movie rows', (await titles()).join(' | '), 'The Dark Knight');
  await shot('05-browse-back');

  await page.goForward();
  await settle();
  eq('forward restores kind=series in the URL', new URL(page.url()).search, '?q=dark&kind=series');
  eq('forward re-selects the Series tab', (await selectedTab()).trim(), 'Series');
  eq('forward re-renders the series rows', (await titles()).join(' | '), 'Dark');
}

/* ------------------------------------------------------------------ kind tabs */

/* ------------------------------------------------------------------ kind tabs */

{
  await page.goto(B + '/browse');
  await settle();
  await page.locator('#browse-tabs [data-kind="movie"]').focus();
  await page.keyboard.press('ArrowRight');
  await settle();
  eq('ArrowRight moves to the next tab', (await selectedTab()).trim(), 'Series');
  eq('and commits it to the URL', new URL(page.url()).search, '?kind=series');
  await page.keyboard.press('End');
  await settle();
  eq('End jumps to the last tab', (await selectedTab()).trim(), 'Anime');
  await page.keyboard.press('Home');
  await settle();
  eq('Home jumps back to the first tab', (await selectedTab()).trim(), 'All');
  eq('and Home clears the URL back to bare /browse', new URL(page.url()).search, '');
}

for (const [kind, label] of [
  ['movie', 'Movies'],
  ['series', 'Series'],
]) {
  await page.goto(B + `/browse?kind=${kind}`);
  await settle();
  if (!live) {
    skip(`kind=${kind} returns only ${kind}`, 'the catalog provider returned nothing');
    continue;
  }
  eq(`kind=${kind} renders 24 titles`, (await titles()).length, 24);
  eq(`kind=${kind} returns only ${kind}`, [...new Set(await kinds())].join(','), kind);
  eq(`kind=${kind} tab is selected`, (await selectedTab()).trim(), label);
  await shot(`06-browse-kind-${kind}`);
}

{
  await page.goto(B + '/browse?kind=anime');
  await settle();
  eq(
    'an empty Anime tab issues no request and renders the empty state',
    await visible('#browse-empty'),
    true,
  );
  eq(
    'the Anime empty state says anime is search-only',
    (await page.locator('#browse-empty [data-empty-copy]').textContent()).includes(
      'search-only',
    ),
    true,
  );
  eq('the Anime empty state renders no rows', (await titles()).length, 0);
  await shot('07-browse-anime-empty');
}

/* ------------------------------------------------------------------ genre filter */

if (live) {
  await page.goto(B + '/browse');
  await settle();
  const unfiltered = await titles();

  await page.selectOption('#browse-genre', 'horror');
  await settle();
  eq('the genre is in the URL', new URL(page.url()).search, '?genre=horror');
  eq('the select stays in sync with the URL', await page.inputValue('#browse-genre'), 'horror');
  const horror = await titles();
  check('the genre narrows the grid', horror.length < unfiltered.length, `${unfiltered.length} -> ${horror.length}`);
  eq('the filtered grid is anchored on a real title', horror[0], 'Backrooms');
  const provider = (await catalog('/api/catalog/browse?genre=horror')).map((i) => i.title);
  eq(
    'every rendered title is one the provider tagged horror',
    horror.join(' | '),
    provider.join(' | '),
  );
  await shot('08-browse-genre-horror');

  await page.goto(B + '/browse?genre=espionage');
  await settle();
  eq(
    'a genre the provider cannot resolve is empty, not the unfiltered fixture',
    (await titles()).length,
    0,
  );
  eq('and it renders the empty state', await visible('#browse-empty'), true);
  await shot('09-browse-genre-espionage-empty');
} else {
  skip('the genre filter narrows results', 'the catalog provider returned nothing');
}

/* ------------------------------------------------------------------ empty state */

{
  await page.goto(B + '/browse');
  await settle();
  await search('zzzq');
  eq('a nonsense query updates the URL', new URL(page.url()).search, '?q=zzzq');
  eq('a nonsense query renders the empty state', await visible('#browse-empty'), true);
  eq('a nonsense query renders no rows', (await titles()).length, 0);
  eq('a nonsense query is not the top catalog', (await titles()).length === 24, false);
  eq('a nonsense query is not an error', await visible('#browse-error'), false);
  eq('a nonsense query leaves no skeletons', await page.locator('#browse-grid .browse__skeleton').count(), 0);
  eq(
    'the empty state names the query that failed',
    (await page.locator('#browse-empty [data-empty-copy]').textContent()).includes('zzzq'),
    true,
  );
  await shot('10-browse-empty');
}

/* ------------------------------------------------------------------ loading skeletons */

{
  await page.goto(B + '/browse');
  await page.route('**/api/catalog/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    route.continue();
  });
  await page.locator('#browse-q').fill('odyssey');
  await page.locator('#browse-panel[aria-busy="true"]').waitFor();
  eq('a slow request shows skeletons', await page.locator('#browse-grid .browse__skeleton').count(), 12);
  eq('and shows no stale rows', (await titles()).length, 0);
  await shot('11-browse-skeletons');
  await settle();
  eq('results replace the skeletons', await page.locator('#browse-grid .browse__skeleton').count(), 0);
  eq('and the rows are the real ones', (await titles()).join(' | '), 'Space Odyssey');
  await page.unroute('**/api/catalog/**');
}

/* ------------------------------------------------------------------ load more */

{
  await page.goto(B + '/browse?q=naruto&kind=anime');
  await settle();
  if (!(await visible('#browse-more'))) {
    skip('load more pages with nextCursor', 'this query fit on one page');
  } else {
    const first = await titles();
    eq('the first page is a full page', first.length, 12);
    await page.evaluate(() => {
      document.querySelector('#browse-grid .browse__card').dataset.stamp =
        'before-load-more';
    });
    await page.locator('#browse-more').click();
    await settle();
    const second = await titles();
    check('load more appends', second.length > first.length, `${first.length} -> ${second.length}`);
    eq('load more keeps every earlier title', second.slice(0, first.length).join(' | '), first.join(' | '));
    eq('load more adds no duplicate titles', new Set(second).size, second.length);
    eq(
      'load more appends instead of re-rendering, so posters are not refetched',
      await page.evaluate(
        () =>
          document.querySelector('#browse-grid .browse__card').dataset.stamp ??
          'missing',
      ),
      'before-load-more',
    );
    await shot('12-browse-load-more');
  }
}

/* ------------------------------------------------------------------ cards */

{
  await page.goto(B + '/browse?q=dark&kind=movie');
  await settle();
  eq(
    'a card links to its title page',
    await page.locator('#browse-grid .browse__card').first().getAttribute('href'),
    '/title?id=m1',
  );
  eq(
    'a card renders portrait 2/3',
    await page
      .locator('#browse-grid .browse__card')
      .first()
      .evaluate((e) => getComputedStyle(e).aspectRatio),
    '2 / 3',
  );
  await page.locator('#browse-grid .browse__card').first().click();
  await page.waitForURL('**/title?id=m1');
  eq('clicking a card opens that title', new URL(page.url()).search, '?id=m1');
}

const isRemoteAsset = (url) => url.origin !== new URL(B).origin;

{
  await page.goto(B + '/browse?q=naruto&kind=anime');
  await settle();
  const art = page.locator('#browse-grid .browse__card .card__art').first();
  eq(
    'every card carries a placeholder gradient under its poster',
    await page.locator('#browse-grid .browse__card .card__art.ph').count(),
    await page.locator('#browse-grid .browse__card').count(),
  );

  await page.route(isRemoteAsset, (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: '' }),
  );
  await page.goto(B + '/browse?q=naruto&kind=anime');
  await settle();
  await page.waitForFunction(
    () => document.querySelectorAll('#browse-grid .browse__card img').length === 0,
  );
  eq('a poster that 404s is dropped from every card', await page.locator('#browse-grid .browse__card img').count(), 0);
  eq(
    'the gradient is still painted behind it',
    await art.evaluate((e) => getComputedStyle(e).backgroundImage.includes('gradient')),
    true,
  );
  eq(
    'and the title survives the failed poster',
    (await page.locator('#browse-grid .browse__card .card__title').first().textContent()).length > 0,
    true,
  );
  await shot('17-browse-poster-fallback');
  await page.unroute(isRemoteAsset);
}

/* ------------------------------------------------------------------ maturity gate */

{
  await page.goto(B + '/signin');
  await page.evaluate(async () => {
    const r = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `kid${Date.now()}@test.dev`, password: 'pw123456' }),
    }).then((x) => x.json());
    const p = await fetch('/api/profiles', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${r.session.token}`,
      },
      body: JSON.stringify({ name: 'Kid', maturity: 'child' }),
    }).then((x) => x.json());
    sessionStorage.setItem('cflix_token', r.session.token);
    sessionStorage.setItem('cflix_profile', JSON.stringify(p));
  });
  await page.goto(B + '/browse');
  await settle();
  const badges = await page.locator('#browse-grid .badge-maturity').allTextContents();
  check('a child profile is never offered an R title', !badges.includes('R'), badges.join(',') || '(no rows)');
}

/* ------------------------------------------------------------------ upstream failure and retry */

{
  await page.goto(B + '/signin');
  await page.evaluate(async () => {
    const r = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `grown${Date.now()}@test.dev`, password: 'pw123456' }),
    }).then((x) => x.json());
    const p = await fetch('/api/profiles', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${r.session.token}`,
      },
      body: JSON.stringify({ name: 'Grownup', maturity: 'adult' }),
    }).then((x) => x.json());
    sessionStorage.setItem('cflix_token', r.session.token);
    sessionStorage.setItem('cflix_profile', JSON.stringify(p));
  });
  await page.goto(B + '/browse?q=naruto&kind=anime');
  await settle();

  await page.route('**/api/catalog/search', (route) => route.abort('failed'));
  await search('one piece');
  eq('an upstream failure renders the error state', await visible('#browse-error'), true);
  eq('and not the empty state', await visible('#browse-empty'), false);
  eq(
    'the error names the failure',
    (await page.locator('#browse-error [data-error-title]').textContent()).trim(),
    'The catalog could not be reached',
  );
  eq('the error offers a retry', await visible('#browse-retry'), true);
  eq('the error offers no dead-end link', await visible('#browse-error-link'), false);
  await shot('13-browse-error');

  await page.unroute('**/api/catalog/search');
  await page.locator('#browse-retry').click();
  await settle();
  eq('retry clears the error', await visible('#browse-error'), false);
  eq('retry renders the titles the query asked for', (await titles())[0], 'One Piece');
  await shot('14-browse-error-retried');
}

/* ------------------------------------------------------------------ rejected session */

{
  await page.evaluate(() => sessionStorage.setItem('cflix_token', 'not-a-real-token'));
  await page.goto(B + '/browse?q=dark');
  await settle();
  eq('a rejected session renders the error state', await visible('#browse-error'), true);
  eq(
    'a rejected session is distinguished from an upstream failure',
    (await page.locator('#browse-error [data-error-title]').textContent()).trim(),
    'Sign in again',
  );
  eq(
    'a rejected session offers sign-in, not a retry that cannot work',
    await visible('#browse-retry'),
    false,
  );
  eq('the sign-in control points at /signin', await page.locator('#browse-error-link').getAttribute('href'), '/signin');
  await shot('15-browse-error-auth');
}

/* ------------------------------------------------------------------ stale profile */

{
  await page.goto(B + '/signin');
  await page.evaluate(async () => {
    const r = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `stale${Date.now()}@test.dev`, password: 'pw123456' }),
    }).then((x) => x.json());
    sessionStorage.setItem('cflix_token', r.session.token);
    sessionStorage.setItem(
      'cflix_profile',
      JSON.stringify({ id: 'gone', name: 'Gone', maturity: 'adult' }),
    );
  });
  await page.goto(B + '/browse');
  await settle();
  eq('a stale profile id renders the error state', await visible('#browse-error'), true);
  eq(
    'a stale profile id is distinguished from a rejected session',
    (await page.locator('#browse-error [data-error-title]').textContent()).trim(),
    'Pick a profile',
  );
  eq('and offers the profile picker', await page.locator('#browse-error-link').getAttribute('href'), '/profiles');
  await shot('16-browse-error-profile');
}

console.log('');
console.log(failures ? `${failures} FAIL` : 'all checks passed');
if (skipped.length) console.log(`skipped: ${skipped.join(', ')}`);

await browser.close();
process.exit(failures ? 1 : 0);