/**
 * Page-load timings for six of the seven routes `PAGE_MAP` serves. `/profiles` is the one
 * omitted, and it is omitted rather than missed.
 *
 * The metric is time to a page-specific readiness signal read inside the page with
 * `performance.now()`. Not `load`, not Playwright's wall clock.
 *
 * `performance.now()` runs from navigation start, so the number covers the HTML fetch, the
 * module fetch, and any API round trip the page waits on. For the four data pages that API
 * round trip is the point: `load` and `domContentLoaded` both fire while the rails are still
 * empty, so both would report a time the user never experiences as finished. `/` and
 * `/signin` have no such fetch and their signals are satisfied by the parsed document, so
 * for those two rows the number is document load. Playwright's wall clock would add the CDP
 * round trip on top of all of it, which is harness cost rather than page cost.
 */
import { chromium } from 'playwright';
import { timingClient } from './boot.mjs';
import { summarize } from './stats.mjs';

const READY_TIMEOUT_MS = 15000;

/**
 * One navigation. Returns the pathname the browser ended on as well as the time, so a page
 * that redirected somewhere else cannot be filed under the route that was asked for.
 */
async function visitOnce(context, baseUrl, path, spec, headers, playRef) {
  const page = await context.newPage();
  await page.addInitScript(
    ({ token, profile, ref }) => {
      sessionStorage.setItem('cflix_token', token);
      sessionStorage.setItem('cflix_profile', JSON.stringify(profile));
      if (ref) sessionStorage.setItem('cflix_play_ref', JSON.stringify(ref));
    },
    {
      token: headers.authorization.replace('Bearer ', ''),
      profile: { id: headers['x-cflix-profile'] },
      ref: playRef,
    },
  );

  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'commit' });
    await page.waitForFunction(spec.ready, null, { timeout: READY_TIMEOUT_MS });
    return {
      readyAt: await page.evaluate(() => performance.now()),
      landedOn: await page.evaluate(() => location.pathname),
    };
  } catch (err) {
    return {
      readyAt: null,
      landedOn: await page
        .evaluate(() => location.pathname)
        .catch(() => '(page closed)'),
      error: err.message.split('\n')[0],
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * One readiness predicate per page. Each is a literal a user could see: a rendered card, a
 * form they can type into, a title that came back from the API. A page that never reaches
 * its signal is counted as a failure, not reported as a fast page.
 */
const STATIC_PAGE_READY = {
  '/': {
    ready: `!!document.querySelector('.land__h1')`,
    what: 'landing headline in the document',
  },
  '/signin': {
    ready: `!!document.querySelector('#btn-signin')`,
    what: 'sign-in form in the document',
  },
  '/home': {
    ready: `document.querySelectorAll('#row-trending .card').length > 0`,
    what: 'first trending card rendered',
  },
  '/browse': {
    ready: `document.querySelectorAll('#browse-grid .card').length > 0`,
    what: 'first browse card rendered',
  },
};

/** `/title` and `/watch` need the live id, and `/watch` needs a title that carries a trailer. */
function dynamicPages(liveId, trailerId) {
  const pages = {
    [`/title?id=${liveId}`]: {
      ready: `!!document.querySelector('#detail-title')?.textContent?.trim()`,
      what: 'detail title populated from the API',
    },
  };

  if (trailerId) {
    pages['/watch'] = {
      ready: `!!document.querySelector('.player__title')?.textContent?.trim()`,
      what: 'player title populated from /api/play',
      playRef: { kind: 'movie', id: trailerId },
    };
  }

  return pages;
}

/**
 * @param {{runs?: number}} options `runs` defaults to 5. Each sample is a full browser
 * navigation, so more samples cost real wall clock and 5 is the smallest count with a median.
 */
export async function measurePages({ runs = 5 } = {}) {
  const client = await timingClient();
  const { baseUrl, headers, liveId } = client;

  const catalog = await fetch(`${baseUrl}/api/catalog/browse?kind=movie`, {
    headers,
  }).then((r) => r.json());
  const trailerId = catalog.items?.find((i) => i.trailerYtId)?.id;

  // Every provider read these pages depend on is taken once, untimed. A page row should
  // report page cost; without this the first row would also report a second copy of the
  // upstream round trip the API table already measures.
  for (const path of [
    `/api/catalog/get?id=${encodeURIComponent(liveId)}`,
    '/api/catalog/browse?kind=series',
    `/api/catalog/related?id=${encodeURIComponent(liveId)}`,
  ]) {
    await fetch(`${baseUrl}${path}`, { headers });
  }

  const pages = { ...STATIC_PAGE_READY, ...dynamicPages(liveId, trailerId) };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const results = [];
  try {
    for (const [path, spec] of Object.entries(pages)) {
      const before = await visitOnce(
        context,
        baseUrl,
        path,
        spec,
        headers,
        spec.playRef,
      );

      const samples = [];
      const landedOn = new Set();
      const errors = [];
      for (let i = 0; i < runs; i++) {
        const visit = await visitOnce(
          context,
          baseUrl,
          path,
          spec,
          headers,
          spec.playRef,
        );
        landedOn.add(visit.landedOn);
        if (visit.readyAt === null) errors.push(visit.error);
        else samples.push(visit.readyAt);
      }

      const s = summarize(samples);
      results.push({
        path,
        what: spec.what,
        ...s,
        failures: runs - samples.length,
        samples,
        // Published, not discarded: the first navigation pays for script compilation and a
        // cold JIT, and a reader needs to see that cost separated from the steady state.
        firstRunMs: before.readyAt,
        landedOn: [...landedOn],
        errors,
      });

      process.stdout.write(
        `  ${path}\n    ${spec.what}: median ${s.median} ms, range ${s.min}-${s.max} ms (n=${s.n}, first run ${before.readyAt === null ? 'failed' : `${Math.round(before.readyAt)} ms`}, ${runs - samples.length} never ready)\n`,
      );
    }
  } finally {
    await browser.close();
    client.stop();
  }

  return { liveId, trailerId, results };
}
