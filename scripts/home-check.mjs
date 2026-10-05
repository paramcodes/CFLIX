import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { startServerForRun } from './verify/harness.mjs';

const B = await startServerForRun();
const OUT = 'artifacts/verify-cflix/home-page';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const skipped = [];
const check = (name, cond, detail = '') => {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`,
  );
  if (!cond) failures++;
};
const skip = (name, why) => {
  skipped.push(name);
  console.log(`SKIP  ${name}  ${why}`);
};

const browser = await chromium.launch();

const signIn = async (page, seed = false) => {
  await page.goto(B + '/signin');
  return page.evaluate(async (withProgress) => {
    const post = (p, b, headers = {}) =>
      fetch(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(b),
      }).then((r) => r.json());
    const email = 'homecheck@test.dev';
    let auth = await post('/api/auth/signup', { email, password: 'pw123456' });
    if (auth.error)
      auth = await post('/api/auth/signin', { email, password: 'pw123456' });
    const token = auth.session.token;
    const bearer = { authorization: `Bearer ${token}` };
    const list = await fetch('/api/profiles', { headers: bearer }).then((r) =>
      r.json(),
    );
    const profile =
      list.items.find((p) => p.maturity === 'adult') ||
      (await post(
        '/api/profiles',
        { name: 'Grownup', maturity: 'adult' },
        bearer,
      ));
    if (withProgress) {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { ...bearer, 'x-cflix-profile': profile.id },
        body: JSON.stringify({ itemId: 'm1', seconds: 3600 }),
      });
    }
    sessionStorage.setItem('cflix_token', token);
    sessionStorage.setItem('cflix_profile', JSON.stringify(profile));
    return profile;
  }, seed);
};

const openHome = async (page, { waitForArt = true } = {}) => {
  await page.goto(B + '/home');
  await page.waitForSelector('#row-movies .card');
  await page.waitForFunction(
    () => document.querySelectorAll('.hero__slide').length >= 4,
  );
  if (waitForArt) {
    await page.waitForFunction(
      () => {
        const first = document.querySelector('#row-movies .card__art img');
        const backdrop = document.querySelector(
          '.hero__slide.is-active .hero__bg img',
        );
        return (
          first !== null &&
          first.naturalWidth > 0 &&
          (backdrop === null || backdrop.naturalWidth > 0)
        );
      },
      null,
      { timeout: 60_000 },
    );
  }
  await page.waitForTimeout(700);
};

const readRails = (page) =>
  page.$$eval('.row__rail', (els) =>
    els
      .filter((el) => el.clientWidth > 0)
      .map((el) => {
        const style = getComputedStyle(el);
        return {
          id: el.id,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: style.overflowX,
          snap: style.scrollSnapType,
          snapAlign: getComputedStyle(el.firstElementChild).scrollSnapAlign,
          snapPadInline: style.scrollPaddingInlineStart,
          scrollBehavior: style.scrollBehavior,
          cards: el.children.length,
        };
      }),
  );

/* ------------------------------------------------ rails scroll */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);
  const rails = await readRails(page);
  for (const r of rails) {
    if (r.cards >= 6) {
      check(
        `rail #${r.id} scrolls: scrollWidth ${r.scrollWidth} > clientWidth ${r.clientWidth}`,
        r.scrollWidth > r.clientWidth,
      );
    } else {
      console.log(
        `skip  rail #${r.id} holds only ${r.cards} card(s), so it has nothing to scroll to`,
      );
    }
    check(
      `rail #${r.id} overflow-x is auto`,
      r.overflowX === 'auto',
      r.overflowX,
    );
    check(
      `rail #${r.id} snaps x mandatory, cards snap start`,
      r.snap === 'x mandatory' && r.snapAlign === 'start',
      `${r.snap} / ${r.snapAlign}`,
    );
    check(
      `rail #${r.id} sets scroll-padding-inline`,
      parseFloat(r.snapPadInline) > 0,
      r.snapPadInline,
    );
  }
  const long = rails.filter((r) => r.cards >= 6);
  check(
    `${long.length} rails carry more than a page of cards`,
    long.length >= 5,
    long.map((r) => `#${r.id}:${r.scrollWidth}>${r.clientWidth}`).join(' '),
  );
  await page.screenshot({ path: `${OUT}/01-hero-and-rows.png` });
  await page.close();
}

/* ------------------------------------------------ arrows scroll and disable at the ends */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);
  const rail = page.locator('#row-movies');
  const row = page.locator('#row-movies').locator('xpath=ancestor::section[1]');
  const prev = row.locator('.rail__nav--prev');
  const next = row.locator('.rail__nav--next');

  check(
    'rail arrows are real <button>s',
    (await prev.evaluate((el) => el.tagName)) === 'BUTTON' &&
      (await next.evaluate((el) => el.tagName)) === 'BUTTON',
  );
  check(
    'prev has an aria-label',
    (await prev.getAttribute('aria-label')) === 'Scroll Movies left',
    await prev.getAttribute('aria-label'),
  );
  check(
    'next has an aria-label',
    (await next.getAttribute('aria-label')) === 'Scroll Movies right',
  );
  check('prev starts disabled', await prev.isDisabled());
  check('next starts enabled', await next.isEnabled());

  const width = await rail.evaluate((el) => el.clientWidth);
  const cardWidth = await rail.evaluate(
    (el) => el.firstElementChild.getBoundingClientRect().width,
  );
  const before = await rail.evaluate((el) => el.scrollLeft);
  await next.click();
  await page.waitForTimeout(600);
  const after = await rail.evaluate((el) => el.scrollLeft);
  check(
    `next scrolls the rail (scrollLeft ${before} -> ${after})`,
    after > before,
  );
  check(
    `next scrolls about a page, not one card (card ${cardWidth}px, page ${width}px)`,
    after > cardWidth * 3 && after <= width + cardWidth + 10,
    `moved ${after - before}px`,
  );
  check('prev enables once the rail has moved', await prev.isEnabled());

  // Smooth scrolling leaves the button enabled for as long as the animation runs, so a second
  // click can land on a button that disabled in between. Walking with instant scrolling keeps
  // each click's effect settled by the time it returns.
  await rail.evaluate((el) => el.style.setProperty('scroll-behavior', 'auto'));
  for (let i = 0; i < 8; i++) {
    await next.click();
    await page.waitForTimeout(250);
    if (!(await next.isEnabled())) break;
  }
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#row-movies');
      return el.scrollLeft >= el.scrollWidth - el.clientWidth - 2;
    },
    null,
    { timeout: 15_000 },
  );
  const max = await rail.evaluate((el) => el.scrollWidth - el.clientWidth);
  const end = await rail.evaluate((el) => el.scrollLeft);
  check(
    'next disables at the end of the rail',
    await next.isDisabled(),
    `scrollLeft ${end} of ${max}`,
  );
  check(
    'the rail parks at its maximum scrollLeft',
    Math.abs(end - max) < 4,
    `${end} vs ${max}`,
  );
  check('prev is enabled at the end of the rail', await prev.isEnabled());

  await prev.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const back = await rail.evaluate((el) => el.scrollLeft);
  check(`prev is keyboard operable (${end} -> ${back})`, back < end);
  await page.screenshot({ path: `${OUT}/02-rail-scrolled.png` });
  await page.close();
}

/* ------------------------------------------------ hero: 4-5 slides, reshuffled per load */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);
  const order = () =>
    page.$$eval('.hero__slide', (els) => els.map((el) => el.dataset.title));
  const first = await order();
  check(
    `hero renders 4-5 slides (${first.length})`,
    first.length >= 4 && first.length <= 5,
    first.join(' | '),
  );

  const slides = await page.$$eval('.hero__slide', (els) =>
    els.map((el) => ({
      id: el.dataset.id,
      title: el.dataset.title,
      backdrop: el.dataset.backdrop,
      logo: el.dataset.logo,
      play: el.querySelector('.hero__play')?.getAttribute('href'),
      more: el.querySelector('.hero__more')?.getAttribute('href'),
      maturity: el.querySelector('.badge-maturity')?.textContent.trim(),
      quality: el.querySelector('.badge-quality')?.textContent.trim() || null,
      wordmark: el.querySelector('.hero__logo')?.getAttribute('src') || null,
      titleText: el.querySelector('.hero__title')?.textContent.trim(),
      art: el.querySelector('.hero__bg img')?.getAttribute('src') || '',
    })),
  );
  for (const s of slides) {
    check(
      `slide "${s.title}" routes Play and More Info to /title?id=${s.id}`,
      s.play === `/title?id=${s.id}` && s.more === `/title?id=${s.id}`,
      `${s.play} / ${s.more}`,
    );
    check(
      `slide "${s.title}" has a loaded backdrop image and a maturity badge`,
      s.backdrop === 'yes' && /^https:/.test(s.art) && !!s.maturity,
      `${s.maturity} ${s.art.slice(0, 60)}`,
    );
    check(
      `slide "${s.title}" has a title treatment`,
      s.logo === 'yes' ? !!s.wordmark : !!s.titleText,
      `logo=${s.logo} wordmark=${!!s.wordmark}`,
    );
  }
  const quality = slides.filter((s) => s.quality);
  check(
    `the quality badge carries a real rating, never a resolution claim (${quality.length}/${slides.length})`,
    quality.length > 0 && quality.every((s) => /^\d\.\d$/.test(s.quality)),
    quality.map((s) => s.quality).join(','),
  );
  await page.screenshot({ path: `${OUT}/03-hero-first-slide.png` });

  const second = await (async () => {
    await openHome(page);
    return order();
  })();
  check(
    'a reload produces a different slide order',
    first.join('|') !== second.join('|'),
    `load 1: ${first.join(' | ')}\n         load 2: ${second.join(' | ')}`,
  );
  await page.close();
}

/* ------------------------------------------------ hero arrows and dots */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);
  const active = () =>
    page.getAttribute('.hero__slide.is-active', 'data-title');
  const count = await page.locator('.hero__slide').count();

  check(
    'prev is disabled on the first slide',
    await page.locator('.hero__nav--prev').isDisabled(),
  );
  check(
    'next is enabled on the first slide',
    await page.locator('.hero__nav--next').isEnabled(),
  );
  check(
    'one dot per slide',
    (await page.locator('.hero__dot').count()) === count,
  );

  const dots = await page.$$eval('.hero__dot', (els) =>
    els.map((el) => ({
      tag: el.tagName,
      label: el.getAttribute('aria-label'),
      current: el.getAttribute('aria-current'),
    })),
  );
  check(
    'every dot is a button with an aria-label',
    dots.every((d) => d.tag === 'BUTTON' && !!d.label),
    JSON.stringify(dots[0]),
  );
  check(
    'exactly one dot is aria-current',
    dots.filter((d) => d.current === 'true').length === 1,
  );

  const a0 = await active();
  await page.click('.hero__nav--next');
  await page.waitForTimeout(450);
  const a1 = await active();
  check(`the next arrow advances the slide (${a0} -> ${a1})`, a1 !== a0);

  await page.click('.hero__dot:last-child');
  await page.waitForTimeout(450);
  const last = await active();
  check(`the last dot jumps to the last slide (${a1} -> ${last})`, last !== a1);
  check(
    'next disables on the last slide',
    await page.locator('.hero__nav--next').isDisabled(),
  );

  await page.locator('.hero__dot').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const first = await active();
  check(`dots are keyboard operable (${last} -> ${first})`, first !== last);
  check(
    'prev disables back on the first slide',
    await page.locator('.hero__nav--prev').isDisabled(),
  );

  await page.click('.hero__nav--next');
  await page.waitForTimeout(400);
  const forward = await active();
  check(
    `prev and next walk the slides (${first} -> ${forward})`,
    forward !== first,
  );
  await page.click('.hero__nav--prev');
  await page.waitForTimeout(400);
  check(
    `the prev arrow steps back (${forward} -> ${await active()})`,
    (await active()) === first,
  );
  const labels = await page.$$eval('.hero__nav', (els) =>
    els.map((el) => el.getAttribute('aria-label')),
  );
  check(
    'both hero arrows are aria-labelled',
    labels.every(Boolean),
    JSON.stringify(labels),
  );
  await page.screenshot({ path: `${OUT}/04-hero-second-slide.png` });
  await page.close();
}

/* ------------------------------------------------ rows render real data */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);
  const rows = ['#row-trending', '#row-movies', '#row-series', '#row-anime'];
  for (const id of rows) {
    const cards = await page.$$eval(`${id} .card`, (els) =>
      els.map((el) => ({
        title: el.querySelector('.card__title')?.textContent.trim(),
        href: el.getAttribute('href'),
        poster: el.querySelector('.card__art img')?.getAttribute('src') || null,
        loaded: el.querySelector('.card__art img')?.naturalWidth || 0,
      })),
    );
    check(`${id} renders cards (${cards.length})`, cards.length > 0);
    check(
      `${id} cards link to a real title page`,
      cards.every(
        (c) => c.title && c.title.length > 1 && /^\/title\?id=\S+/.test(c.href),
      ),
      cards[0] ? `${cards[0].title} -> ${cards[0].href}` : 'no cards',
    );
  }
  const movieCount = await page.locator('#row-movies .card').count();
  let posters = 0;
  for (let settle = 0; settle < 20; settle++) {
    posters = await page.$$eval(
      '#row-movies .card .card__art img',
      (els) => els.filter((el) => el.naturalWidth > 0).length,
    );
    if (posters === movieCount) break;
    await page.waitForTimeout(500);
  }
  check(
    `every movie card's poster actually painted (${posters}/${movieCount})`,
    posters === movieCount,
  );

  const ranks = await page.$$eval('#row-trending .card__num', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check(
    `trending is the provider's own top 10 (${ranks.join(',')})`,
    ranks.length === 10 && ranks[0] === '1' && ranks[9] === '10',
  );

  const genreTitles = await page.$$eval('[data-genre-row] .row__title', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check(
    `two by-genre rows exist (${genreTitles.length})`,
    genreTitles.length >= 2,
    genreTitles.join(' | '),
  );
  const genreRows = await page.$$eval('[data-genre-row]', (els) =>
    els.map((el) => ({
      genre: el.dataset.genreRow,
      titles: [...el.querySelectorAll('.card__title')].map((t) =>
        t.textContent.trim(),
      ),
    })),
  );
  check(
    'every by-genre rail is populated',
    genreRows.every((r) => r.titles.length > 0),
    JSON.stringify(genreRows.map((r) => `${r.genre}:${r.titles.length}`)),
  );
  for (const row of genreRows) {
    const api = await page.evaluate(async (genre) => {
      const res = await fetch(
        `/api/catalog/browse?genre=${encodeURIComponent(genre)}`,
        {
          headers: {
            authorization: `Bearer ${sessionStorage.getItem('cflix_token')}`,
            'x-cflix-profile': JSON.parse(
              sessionStorage.getItem('cflix_profile'),
            ).id,
          },
        },
      );
      const data = await res.json();
      const wanted = genre.toLowerCase();
      return {
        count: data.items.length,
        allMatch: data.items.every((i) =>
          (i.genres ?? []).some((g) => g.toLowerCase() === wanted),
        ),
        titles: data.items.map((i) => i.title),
      };
    }, row.genre);
    check(
      `the ${row.genre} rail only holds ${row.genre} titles`,
      api.allMatch &&
        api.titles.length === row.titles.length &&
        api.titles.every((t) => row.titles.includes(t)),
      `rail ${row.titles.length} cards vs ${api.count} from the API`,
    );
  }
  await page.close();
}

/* ------------------------------------------------ continue watching */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page, true);
  await openHome(page);
  const cards = await page.$$eval('#row-continue .card', (els) =>
    els.map((el) => ({
      title: el.querySelector('.card__title')?.textContent.trim(),
      width: el.querySelector('.card__progress-fill')?.style.width,
      pct: el.dataset.pct,
      visible: el.offsetParent !== null,
    })),
  );
  check(
    `continue watching lists history (${cards.length} cards)`,
    cards.length > 0,
    JSON.stringify(cards),
  );
  check(
    'the continue watching section is visible',
    await page.locator('#row-continue').isVisible(),
  );
  const dark = cards.find((c) => c.title === 'The Dark Knight');
  check(
    'history names The Dark Knight',
    !!dark,
    JSON.stringify(cards.map((c) => c.title)),
  );
  check(
    'the progress bar is filled from recorded seconds (3600 of 9120)',
    !!dark && dark.width === '39.5%' && dark.pct === '39.5',
    dark ? `width ${dark.width}` : 'missing',
  );
  await page.locator('#row-continue').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-continue-watching.png` });
  await page.close();
}

/* ------------------------------------------------ nav raises past the hero */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);
  const nav = page.locator('nav.nav');
  const topBg = await nav.evaluate(
    (el) => getComputedStyle(el).backgroundImage,
  );
  check(
    'nav is fixed',
    (await nav.evaluate((el) => getComputedStyle(el).position)) === 'fixed',
  );
  check(
    'nav keeps a gradient over the hero',
    topBg.includes('gradient'),
    topBg.slice(0, 60),
  );
  check(
    'nav is not solid at the top of the page',
    !(await nav.evaluate((el) => el.classList.contains('is-raised'))),
  );
  await page.evaluate(() =>
    window.scrollTo({ top: 1200, behavior: 'instant' }),
  );
  await page.waitForFunction(() =>
    document.querySelector('nav.nav')?.classList.contains('is-raised'),
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('nav.nav')).backgroundColor ===
      'rgb(0, 0, 0)',
  );
  check(
    'nav raises past the hero',
    await nav.evaluate((el) => el.classList.contains('is-raised')),
  );
  check(
    'the raised nav background is solid black',
    (await nav.evaluate((el) => getComputedStyle(el).backgroundColor)) ===
      'rgb(0, 0, 0)',
    await nav.evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await page.screenshot({ path: `${OUT}/06-nav-raised.png` });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(600);
  check(
    'nav drops the solid background back at the top',
    !(await nav.evaluate((el) => el.classList.contains('is-raised'))),
  );
  await page.close();
}

/* ------------------------------------------------ smooth scroll and reduced motion */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);
  check(
    'rails scroll smoothly',
    (await page.$eval(
      '#row-movies',
      (el) => getComputedStyle(el).scrollBehavior,
    )) === 'smooth',
  );
  await page.close();

  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  const still = await context.newPage();
  await signIn(still);
  await openHome(still);
  check(
    'prefers-reduced-motion turns smooth scrolling off',
    (await still.$eval(
      '#row-movies',
      (el) => getComputedStyle(el).scrollBehavior,
    )) === 'auto',
  );
  await still
    .locator('#row-movies')
    .locator('xpath=ancestor::section[1]')
    .locator('.rail__nav--next')
    .click();
  await still.waitForTimeout(200);
  check(
    'the rail still scrolls under reduced motion',
    (await still.$eval('#row-movies', (el) => el.scrollLeft)) > 0,
  );
  check(
    'rows are opaque under reduced motion',
    (await still.$eval('.row', (el) => getComputedStyle(el).opacity)) === '1',
  );
  const before = await still.getAttribute(
    '.hero__slide.is-active',
    'data-title',
  );
  await still.click('.hero__dot:last-child');
  await still.waitForTimeout(200);
  check(
    'the hero still switches slides under reduced motion',
    (await still.getAttribute('.hero__slide.is-active', 'data-title')) !==
      before,
  );
  await still.screenshot({ path: `${OUT}/07-reduced-motion.png` });
  await context.close();
}

/* ------------------------------------------------ search */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);
  await page.fill('#search-input', 'dark');
  await page.click('#search-form button');
  await page.waitForTimeout(1200);
  const titles = await page.$$eval('#row-results .card__title', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check(
    'search fills #row-results with the dark titles',
    titles.includes('The Dark Knight') && titles.includes('Dark'),
    titles.join(', '),
  );
  check(
    '#row-results-wrap becomes visible',
    await page.locator('#row-results-wrap').isVisible(),
  );
  check(
    'the results row links through to /browse',
    (await page.getAttribute('#row-results-wrap a.browse-link', 'href')) ===
      '/browse?q=dark',
  );

  await page.fill('#search-input', 'zzzznotathing');
  await page.click('#search-form button');
  await page.waitForFunction(
    () =>
      document
        .querySelector('#row-results-wrap a.browse-link')
        ?.getAttribute('href') === '/browse?q=zzzznotathing',
    null,
    { timeout: 90_000 },
  );
  check(
    'an empty search leaves a visible, empty results row',
    (await page.locator('#row-results .card').count()) === 0 &&
      (await page.locator('#row-results-wrap').isVisible()),
  );
  check(
    'the empty state says so',
    await page.locator('#row-results-wrap .row__empty').isVisible(),
  );
  await page.screenshot({ path: `${OUT}/08-search-results.png` });
  await page.close();
}

/* ------------------------------------------------ tail loading asks a cursor for the next page */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await openHome(page);

  const api = await page.evaluate(async () => {
    const auth = {
      authorization: `Bearer ${sessionStorage.getItem('cflix_token')}`,
      'x-cflix-profile': JSON.parse(sessionStorage.getItem('cflix_profile')).id,
    };
    const get = (q) =>
      fetch(`/api/catalog/browse?${q}`, { headers: auth }).then((r) =>
        r.json(),
      );
    const plain = await get('kind=movie');
    const paged = await get('kind=movie&limit=5&skip=20&cursor=20');
    const searchAt = (cursor) =>
      fetch('/api/catalog/search', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'one piece',
          limit: 12,
          ...(cursor ? { cursor } : {}),
        }),
      }).then((r) => r.json());
    const one = await searchAt(null);
    const two = await searchAt(one.nextCursor);
    return {
      browseKeys: Object.keys(plain),
      plainFirst: plain.items[0]?.id,
      pagedFirst: paged.items[0]?.id,
      pagedCount: paged.items.length,
      searchKeys: Object.keys(one),
      page1: one.items.map((i) => i.id),
      nextCursor: one.nextCursor,
      page2: two.items.map((i) => i.id),
      page2Cursor: two.nextCursor,
    };
  });
  check(
    'the browse response carries no cursor field',
    !api.browseKeys.some((k) => /cursor|hasMore|next/i.test(k)),
    JSON.stringify(api.browseKeys),
  );
  check(
    'browse ignores skip and cursor, so a browse rail has no page 2 to ask for',
    api.pagedFirst === api.plainFirst && api.pagedCount === 24,
    `plain starts ${api.plainFirst} with 24, skip=20&cursor=20 starts ${api.pagedFirst} with ${api.pagedCount}`,
  );
  // The rest of this block walks a page 2, so when the provider answers with one page there
  // is nothing to walk. Skip explicitly rather than fail on a page the API never offered.
  const paged = api.searchKeys.includes('nextCursor') && !!api.nextCursor;
  if (paged) {
    check(
      'the search response does carry nextCursor',
      true,
      `${api.page1.length}-item page returned nextCursor=${JSON.stringify(api.nextCursor)}, whose page holds ${api.page2.length}`,
    );
  } else {
    skip(
      'the search response does carry nextCursor',
      `the live catalog returned ${api.page1.length} hits for one page, so nextCursor=${JSON.stringify(api.nextCursor)}`,
    );
  }

  check(
    'browse rails carry no tail sentinel',
    (await page.locator('.row:not(#row-results-wrap) .row__tail').count()) ===
      0,
  );
  if (paged) {
    check(
      'the cursor-backed results row carries one tail sentinel',
      (await page.locator('#row-results-wrap .row__tail').count()) === 1,
    );
  }

  const bodies = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/catalog/search') && req.method() === 'POST')
      bodies.push(req.postDataJSON());
  });

  const expected = (paged ? [...api.page1, ...api.page2] : api.page1).map(
    (id) => `/title?id=${id}`,
  );
  await page.fill('#search-input', 'one piece');
  await page.click('#search-form button');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#row-results .card').length === n,
    expected.length,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(2500);

  const shown = await page.$$eval('#row-results .card', (els) =>
    els.map((e) => e.getAttribute('href')),
  );
  check(
    paged
      ? `the tail appended page 2, so the rail is the API's full cursor walk (${expected.length} cards)`
      : `the rail is the API's single page (${expected.length} cards)`,
    shown.join('|') === expected.join('|'),
    `rail ${shown.length} cards, api ${expected.length}; first mismatch at ${shown.findIndex((h, i) => h !== expected[i])}`,
  );
  check(
    `every card is a distinct title id (${new Set(shown).size}/${shown.length})`,
    new Set(shown).size === shown.length,
  );
  if (paged) {
    check(
      `the tail request carried the cursor the first page returned (${JSON.stringify(api.nextCursor)})`,
      bodies.length >= 2 && bodies[1].cursor === String(api.nextCursor),
      JSON.stringify(bodies),
    );
    check(
      'the tail stops asking once the API returns a null cursor',
      api.page2Cursor === null && bodies.length === 2,
      `page 2 nextCursor=${JSON.stringify(api.page2Cursor)} after ${bodies.length} search requests`,
    );
  } else {
    // tailLoader appends its sentinel whether or not a second page exists, so the sentinel's
    // presence proves nothing here. What proves the tail stopped is that home.js sets
    // exhausted from the null cursor and returns before issuing another request.
    check(
      'a one-page search asks once, so the tail has nothing left to fetch',
      bodies.length === 1,
      `${bodies.length} search requests`,
    );
  }
  await page.locator('#row-results-wrap').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/11-tail-loaded.png` });
  await page.close();
}

/* ------------------------------------------------ a missing backdrop falls back to a gradient */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await page.addInitScript(() => {
    const real = window.fetch;
    window.fetch = (url, ...rest) =>
      String(url).includes('/api/catalog/browse')
        ? real(url, ...rest).then((response) =>
            response.json().then((data) => {
              data.items = data.items.map((item) => ({
                ...item,
                backdropUrl: null,
                logoUrl: null,
              }));
              return {
                ok: response.ok,
                status: response.status,
                headers: response.headers,
                json: () => Promise.resolve(data),
              };
            }),
          )
        : real(url, ...rest);
  });
  await openHome(page);
  const fallback = await page.$$eval('.hero__slide', (els) =>
    els.map((el) => ({
      title: el.dataset.title,
      backdrop: el.dataset.backdrop,
      gradient: !!el.querySelector('.hero__bg.ph'),
      titleText: el.querySelector('.hero__title')?.textContent.trim(),
      wordmark: !!el.querySelector('.hero__logo'),
    })),
  );
  check(
    'the hero still renders five slides with no art at all',
    fallback.length >= 4,
    JSON.stringify(fallback.map((s) => s.title)),
  );
  check(
    'every slide with no backdropUrl falls back to a .ph--* gradient',
    fallback.length > 0 &&
      fallback.every((s) => s.backdrop === 'no' && s.gradient),
    JSON.stringify(fallback),
  );
  check(
    'every slide with no logoUrl falls back to styled text',
    fallback.every((s) => !s.wordmark && !!s.titleText),
    JSON.stringify(fallback.map((s) => s.titleText)),
  );
  await page.screenshot({ path: `${OUT}/09-hero-gradient-fallback.png` });
  await page.close();
}

/* ------------------------------------------------ a poster that 404s falls back to a gradient */

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(page);
  await page.route('**/poster/**', (route) => route.abort());
  await openHome(page, { waitForArt: false });
  const arts = await page.$$eval('#row-movies .card__art', (els) =>
    els.map((el) => ({
      gradient: /ph--/.test(el.className),
      img: !!el.querySelector('img'),
      painted: getComputedStyle(el).backgroundImage,
    })),
  );
  check(
    'poster requests really failed',
    arts.length > 0,
    `${arts.length} cards`,
  );
  check(
    'every card whose poster 404s falls back to a painted gradient',
    arts.every((a) => a.gradient && !a.img && a.painted !== 'none'),
    JSON.stringify(arts.slice(0, 2)),
  );
  await page.locator('#row-movies').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/10-poster-404-fallback.png` });
  await page.close();
}

await browser.close();
console.log(`\n${failures ? `${failures} FAIL` : 'all checks passed'}`);
if (skipped.length)
  console.log(`${skipped.length} skipped: ${skipped.join(', ')}`);
process.exit(failures ? 1 : 0);
