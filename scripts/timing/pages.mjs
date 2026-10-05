/**
 * Page-load timings for the six pages a user opens.
 *
 * The metric is time to a page-specific readiness signal measured inside the page with
 * `performance.now()`, not `load` and not Playwright's wall clock.
 *
 * Why: every one of these pages renders its content from a `fetch` that starts after the
 * document is parsed, so `load` and `domContentLoaded` both fire before the user can read
 * anything. Waiting on the first rendered row is the point at which the page stops being a
 * spinner. Playwright's own wall clock would also include the CDP round trip, which is
 * harness overhead and not the page.
 *
 * `performance.now()` inside the page measures from navigation start, so it includes the
 * HTML fetch, the module fetch, and the API round trip the user actually waits through.
 */
import { chromium } from 'playwright';
import { bootServer, signIn } from './boot.mjs';
import { summarize } from './stats.mjs';

const READY_TIMEOUT_MS = 15000;

/** One navigation, discarded. The first one pays for script compilation and a cold JIT. */
async function visitOnce(context, baseUrl, path, spec, auth) {
  const page = await context.newPage();
  await page.addInitScript(
    ({ token, profile, playRef }) => {
      sessionStorage.setItem('cflix_token', token);
      sessionStorage.setItem('cflix_profile', JSON.stringify(profile));
      if (playRef)
        sessionStorage.setItem('cflix_play_ref', JSON.stringify(playRef));
    },
    { token: auth.token, profile: auth.profile, playRef: spec.playRef ?? null },
  );
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'commit' });
  try {
    await page.waitForFunction(spec.ready, null, { timeout: READY_TIMEOUT_MS });
    return await page.evaluate(() => ({
      readyAt: performance.now(),
      landedOn: location.pathname,
    }));
  } catch {
    return {
      readyAt: null,
      landedOn: await page.evaluate(() => location.pathname),
    };
  } finally {
    await page.close();
  }
}

/**
 * One readiness predicate per page. Each is a literal a user could see: a rendered card,
 * a populated input, a resolved title. A page that never reaches it is a failure, not a
 * fast page.
 */
export const PAGE_READY = {
  '/': {
    ready: `!!document.querySelector('.land__h1')`,
    what: 'landing headline painted',
  },
  '/signin': {
    ready: `!!document.querySelector('#btn-signin')`,
    what: 'sign-in form interactive',
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

/** `/title` and `/watch` need a live id and a play ref, so they are built after one browse. */
function buildDynamicPages(liveId, trailerId) {
  return {
    [`/title?id=${liveId}`]: {
      ready: `!!document.querySelector('#detail-title')?.textContent?.trim()`,
      what: 'detail title populated from the API',
    },
    ...(trailerId
      ? {
          '/watch': {
            ready: `!!document.querySelector('.player__title')?.textContent?.trim()`,
            what: 'player title populated from /api/play',
            playRef: { kind: 'movie', id: trailerId },
          },
        }
      : {}),
  };
}

/**
 * @param {{runs?: number}} options `runs` defaults to 5: each sample is a full browser
 * navigation, so five is the smallest count that gives a median, and the brief's floor.
 */
export async function measurePages({ runs = 5 } = {}) {
  const server = await bootServer();
  const auth = await signIn(server.baseUrl);
  const headers = {
    authorization: `Bearer ${auth.token}`,
    'x-cflix-profile': auth.profile.id,
  };
  const catalog = await fetch(
    `${server.baseUrl}/api/catalog/browse?kind=movie`,
    { headers },
  ).then((r) => r.json());
  const liveId = catalog.items?.[0]?.id;
  const trailerId = catalog.items?.find((i) => i.trailerYtId)?.id;

  // Pages hit the same cache the API measurement warms, so a page number is page cost and
  // not a second copy of the upstream round trip.
  await fetch(
    `${server.baseUrl}/api/catalog/get?id=${encodeURIComponent(liveId)}`,
    { headers },
  );
  await fetch(`${server.baseUrl}/api/catalog/browse?kind=series`, { headers });
  await fetch(
    `${server.baseUrl}/api/catalog/related?id=${encodeURIComponent(liveId)}`,
    { headers },
  );

  const pages = { ...PAGE_READY, ...buildDynamicPages(liveId, trailerId) };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const results = [];
  try {
    for (const [path, spec] of Object.entries(pages)) {
      const warmup = await visitOnce(context, server.baseUrl, path, spec, auth);
      const samples = [];
      let failures = 0;
      const landedOn = new Set();

      for (let i = 0; i < runs; i++) {
        const visit = await visitOnce(
          context,
          server.baseUrl,
          path,
          spec,
          auth,
        );
        landedOn.add(visit.landedOn);
        if (visit.readyAt === null) failures++;
        else samples.push(visit.readyAt);
      }

      const s = summarize(samples);
      results.push({
        path,
        what: spec.what,
        ...s,
        failures,
        samples,
        warmupMs:
          warmup.readyAt === null ? null : Number(warmup.readyAt.toFixed(1)),
        landedOn: [...landedOn],
      });
      process.stdout.write(
        `  ${path}\n    ${spec.what}: median ${s.median} ms, range ${s.min}-${s.max} ms (n=${s.n}, ${failures} never ready, warmup ${warmup.readyAt === null ? 'failed' : `${Math.round(warmup.readyAt)} ms`})\n`,
      );
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  return { liveId, trailerId, results };
}
