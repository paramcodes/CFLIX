/**
 * The circuit breaker had to be able to open, and could not.
 *
 * Every adapter swallows an upstream failure and resolves `null`, which a list call flattens
 * to `[]` (`getJson` in cinemeta.js, `kit` in kitsu.js, `request` in tvmaze.js). The guarded call
 * therefore RESOLVED on every outage, so `execute` called `onSuccess` each time and the circuit
 * stayed CLOSED forever. Measured against origin/main: 10 simulated outages left the breaker at
 * CLOSED with 0 failures recorded.
 *
 * The first attempt at this fixed it by reading an empty payload as an outage, which was wrong in
 * the other direction: a 404 for an id nobody has and an empty search result have the same shape
 * as a dead CDN, so five ordinary misses took the provider offline and a title that definitely
 * existed answered NOT_FOUND. The distinction therefore has to be made where it is still visible,
 * at each adapter's fetch seam, which reports it through `onUpstreamFailure`. What is asserted
 * here, against the real class or the real `CatalogService`:
 *   - five legitimate misses on a HEALTHY upstream open nothing
 *   - a genuine outage still opens the circuit, and stops reaching upstream
 *   - HALF_OPEN admits exactly one probe, so recovery is not a thundering herd
 *   - a slow-but-successful read is not booked as a failure
 *
 * The upstream is a local stub driven by `CINEMETA_BASE`, so nothing here needs the internet.
 */
import { afterAll, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One upstream request's ceiling, as every adapter declares it: `TIMEOUT_MS` in cinemeta.js. */
const ADAPTER_REQUEST_MS = 8000;
/** `cinemeta.get` asks `meta/series/{id}` then `meta/movie/{id}`, so a miss costs two of those. */
const MAX_UPSTREAM_ASKS = 2;
/** What catalog.js floors the budget at. Asserted against a literal in the suite below. */
const FLOOR_MS = ADAPTER_REQUEST_MS * MAX_UPSTREAM_ASKS;

/** `down` answers 503 like a sick CDN. `ok` answers a catalog built from the request. */
let mode = 'down';
/** Every stub response waits this long, so a slow-but-healthy upstream is expressible. */
let delayMs = 0;
/** Stub requests: the only instrument that proves the breaker stopped reaching upstream. */
let hits = 0;
/** Ids that exist nowhere: the stub answers 404, exactly as the real upstream does. */
const MISSING = new Set();

/** Builds the series the stub serves for `id`, so its episode id is derived, not restated. */
const seriesFor = (id, genres) => ({
  id,
  type: 'series',
  name: 'Stub Signal',
  genres,
  videos: [
    {
      id: `${id}:1:1`,
      season: 1,
      number: 1,
      name: 'Carrier',
      overview: 'One.',
    },
  ],
});

const movieFor = (id, genres) => ({
  id,
  type: 'movie',
  name: 'Stub Feature',
  genres,
});

const stub = createServer((req, res) => {
  hits++;
  const send = () => {
    const path = req.url.split('?')[0];
    const meta = path.match(/^\/meta\/(series|movie)\/([^/]+)\.json$/);
    if (meta && MISSING.has(meta[2])) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not found"}');
    }
    if (mode === 'down') {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end('{"error":"upstream unavailable"}');
    }
    if (meta) {
      // Cinemeta answers the series endpoint with the series and the movie endpoint with null,
      // which is the pair of shapes `cinemeta.get` probes.
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          meta: meta[1] === 'series' ? seriesFor(meta[2], []) : null,
        }),
      );
    }
    // Cinemeta carries the genre as a PATH segment (`catalog/series/top/genre=X.json`), so the
    // stub has to read it there to hand back a rail that survives catalog.js's genre re-filter.
    const genre = path.match(/\/genre=([^/]+)\.json$/)?.[1];
    const genres = genre ? [genre] : [];
    const series = path.includes('/series/');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        metas: [
          series
            ? seriesFor('tt9000002', genres)
            : movieFor('tt9000001', genres),
        ],
      }),
    );
  };
  if (delayMs) setTimeout(send, delayMs);
  else send();
});

const stubPort = await new Promise((resolve, reject) => {
  stub.once('error', reject);
  stub.listen(0, '127.0.0.1', () => resolve(stub.address().port));
});

// Read once at import by the adapter, the cache and the store, so this has to precede the
// dynamic imports below. The adapter timeout is left above every delay this file uses: the
// point is to observe the BREAKER's budget, not to shorten the adapter's.
process.env.CINEMETA_BASE = `http://127.0.0.1:${stubPort}`;
process.env.CINEMETA_TIMEOUT_MS = '30000';
process.env.CFLIX_CACHE_DIR = mkdtempSync(
  join(tmpdir(), 'cflix-breaker-test-'),
);
process.env.CFLIX_DB_PATH = ':memory:';

const { CatalogService, callTimeoutMs, CALL_TIMEOUT_MS } =
  await import('../server/src/catalog.js');
const { db } = await import('../server/src/store.js');
const { CircuitBreaker, getCircuitBreaker, resetAllCircuitBreakers } =
  await import('../server/src/resilience/circuit-breaker.js');
const { cinemeta: cinemetaAdapter } =
  await import('../server/src/providers/cinemeta.js');
const kitsuAdapter = await import('../server/src/providers/kitsu.js');
const tvmazeAdapter = await import('../server/src/providers/tvmaze.js');

const PROFILE = 'p_circuit_test';
const ACCOUNT = 'u_circuit_test';
db.profiles.set(PROFILE, {
  id: PROFILE,
  accountId: ACCOUNT,
  name: 'Adult',
  maturity: 'adult',
});

// `cache` is a process-wide singleton keyed by provider, op and args, so every test below uses
// its own rail, ids and profile. A shared key would let an earlier test's cached answer stand in
// for a later test's upstream call, which is the thing under test.
let tag = 0;
const fresh = () => {
  const n = ++tag;
  return {
    seriesId: `tt6${n}0001`,
    genre: `Genre${n}`,
    missing: Array.from({ length: 5 }, (_, i) => `tt7${n}00${i + 1}`),
  };
};

/** Drives the threshold with legitimate misses and leaves the breaker state behind. */
const missFive = async (missing) => {
  const codes = [];
  for (const id of missing) {
    MISSING.add(id);
    codes.push(
      (await CatalogService.get(PROFILE, id).catch((err) => err)).code ??
        'VALUE',
    );
  }
  return codes;
};

describe('every adapter reports a 429 as an outage and never a 4xx', () => {
  // tvmaze.js has no BASE env seam, so this drives all three through a fetch interceptor rather
  // than giving one adapter an env var the other two do not have. Each call goes through the
  // adapter's real public method, so its real fetch seam and real status handling run.
  const realFetch = globalThis.fetch;
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  const collect = async (fn) => {
    const reasons = [];
    await fn((reason) => reasons.push(reason));
    return reasons;
  };

  const withStatus = async (status, fn) => {
    globalThis.fetch = async () =>
      new Response(status === 404 ? '{"errors":[]}' : '{}', {
        status,
        headers: { 'content-type': 'application/json' },
      });
    return fn();
  };

  const adapters = () => [
    [
      'cinemeta',
      (c) => cinemetaAdapter.get('tt0000001', { onUpstreamFailure: c }),
    ],
    ['kitsu', (c) => kitsuAdapter.get('1', { onUpstreamFailure: c })],
    ['tvmaze', (c) => tvmazeAdapter.get('1', { onUpstreamFailure: c })],
  ];

  it('reports 429 on all three', async () => {
    for (const [name, call] of adapters()) {
      const reasons = await withStatus(429, () => collect(call));
      // Non-empty is the claim under test: an adapter that reports nothing leaves a rate-limit
      // storm invisible, so every request keeps paying the retry budget. `cinemeta.get` makes two
      // `meta` calls and each reports once, so the count is per fetch, not per public call.
      assert.ok(
        reasons.length > 0,
        `${name} did not report a 429 as an outage, so a rate-limit storm never trips the circuit`,
      );
      assert.deepEqual(
        [...new Set(reasons)],
        ['HTTP 429'],
        `${name} reported something other than the 429 it received`,
      );
    }
  });

  it('reports a 5xx on all three', async () => {
    for (const [name, call] of adapters()) {
      const reasons = await withStatus(503, () => collect(call));
      assert.ok(reasons.length > 0, `${name} did not report a 503`);
    }
  });

  it('reports a 404 on none of them, because a 404 is a legitimate miss', async () => {
    for (const [name, call] of adapters()) {
      const reasons = await withStatus(404, () => collect(call));
      assert.deepEqual(
        reasons,
        [],
        `${name} reported a 404 as an outage, so five ordinary misses open the circuit`,
      );
    }
  });
});

describe('a healthy upstream that legitimately has nothing', () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
    mode = 'ok';
    hits = 0;
    delayMs = 0;
    MISSING.clear();
  });

  it('does not open the circuit after five legitimate misses', async () => {
    const t = fresh();
    const codes = await missFive(t.missing);

    assert.deepEqual(
      codes,
      t.missing.map(() => 'NOT_FOUND'),
      'a 404 must read as a miss, not as an outage',
    );
    const breaker = getCircuitBreaker('cinemeta');
    assert.equal(
      breaker.getStatus().state,
      'CLOSED',
      'five ordinary misses took the provider offline',
    );
    assert.equal(breaker.getStatus().consecutiveFailures, 0);
  });

  it('still answers a real title correctly after five misses', async () => {
    const t = fresh();
    await missFive(t.missing);
    assert.equal(getCircuitBreaker('cinemeta').state, 'CLOSED');

    const found = await CatalogService.get(PROFILE, t.seriesId);
    assert.equal(found.id, t.seriesId);
    assert.equal(found.source, 'provider');
    assert.equal(
      found.episodes.length,
      1,
      'a real series still carries its episodes',
    );
  });

  it('still plays and still records progress for a watched title after five misses', async () => {
    const t = fresh();
    await missFive(t.missing);

    const played = await CatalogService.play(ACCOUNT, PROFILE, {
      kind: 'series',
      id: t.seriesId,
    });
    const episodeId = `${t.seriesId}:1:1`;
    assert.equal(played.item.id, episodeId);
    assert.equal(
      Object.hasOwn(played, 'manifestUrl'),
      false,
      'the play response named a manifestUrl again, and /stream/<id>.m3u8 is not a route',
    );

    const progress = await CatalogService.recordProgress(PROFILE, {
      itemId: episodeId,
      seconds: 42,
    });
    assert.equal(progress.itemId, episodeId);
    assert.equal(progress.seconds, 42);
  });

  it('still answers browse and related after five misses', async () => {
    const t = fresh();
    await missFive(t.missing);

    const rail = await CatalogService.browse(PROFILE, 'series', {
      genre: t.genre,
    });
    assert.deepEqual(
      rail.items.map((i) => [i.id, i.source]),
      [['tt9000002', 'provider']],
      'a healthy browse must still answer from the provider',
    );

    // `related` returns the anchor's own kind-mates, and the stub serves exactly one series, so
    // the honest expectation is a list carrying that one id. Asserting only Array.isArray would
    // pass on [], which is the answer a tripped circuit produces.
    const related = await CatalogService.related(PROFILE, t.seriesId);
    assert.deepEqual(
      related.items.map((i) => i.id),
      ['tt9000002'],
      'related must answer with provider data, not an empty list',
    );
  });
});

describe('circuit breaker against a failing upstream', () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
    mode = 'down';
    hits = 0;
    delayMs = 0;
    MISSING.clear();
  });

  afterAll(() => {
    stub.close();
    rmSync(process.env.CFLIX_CACHE_DIR, { recursive: true, force: true });
  });

  it('opens after the threshold of real upstream outages, then stops calling upstream', async () => {
    const genre = fresh().genre;
    // The first read creates the breaker, so this reads the instance providerCall configured
    // rather than a fresh one built with defaults.
    await CatalogService.browse(PROFILE, 'movie', { genre });
    const breaker = getCircuitBreaker('cinemeta');
    assert.equal(breaker.failureThreshold, 5);
    assert.equal(breaker.getStatus().state, 'CLOSED');
    assert.equal(breaker.getStatus().consecutiveFailures, 1);

    for (let i = 1; i < breaker.failureThreshold; i++) {
      await CatalogService.browse(PROFILE, 'movie', { genre });
    }

    assert.equal(breaker.state, 'OPEN');
    assert.equal(breaker.getStatus().consecutiveFailures, 5);

    const hitsWhenOpen = hits;
    assert.ok(hitsWhenOpen > 0, 'no upstream request was made at all');
    for (let i = 0; i < 3; i++)
      await CatalogService.browse(PROFILE, 'movie', { genre });
    assert.equal(hits, hitsWhenOpen, 'an OPEN circuit still reached upstream');
  });

  it('keeps the user-visible answer identical while the circuit is open', async () => {
    const genre = fresh().genre;
    for (let i = 0; i < 5; i++) {
      await CatalogService.browse(PROFILE, 'movie', { genre });
    }

    const { items } = await CatalogService.browse(PROFILE, 'movie', { genre });
    assert.ok(
      items.length > 0,
      'an outage must not answer with an empty catalog',
    );
    assert.deepEqual(
      [...new Set(items.map((i) => i.source))],
      ['seed'],
      'an outage must still answer with the fixture',
    );
  });

  it('does not book a slow-but-successful read as a failure', async () => {
    const t = fresh();
    // Longer than origin/main's 5000ms budget, well inside the budget this change ships, and
    // inside the adapter's own timeout, so the read succeeds. origin/main records it as a
    // failure and books the rail the next five requests share.
    mode = 'ok';
    delayMs = 5500;
    const { items } = await CatalogService.browse(PROFILE, 'series', {
      genre: t.genre,
    });

    const breaker = getCircuitBreaker('cinemeta');
    // The shipped budget has to clear what a legitimate read costs, which is every request the
    // worst adapter makes at its own full timeout, not one request.
    assert.ok(
      breaker.callTimeoutMs >= FLOOR_MS,
      `budget ${breaker.callTimeoutMs}ms does not clear the ${FLOOR_MS}ms a legitimate read costs`,
    );
    assert.equal(
      items[0].source,
      'provider',
      'a slow read must still serve provider items',
    );
    assert.equal(breaker.getStatus().consecutiveFailures, 0);
    assert.equal(breaker.getStatus().state, 'CLOSED');
  }, 30000);

  it('serves a cached answer while OPEN, because a cache hit is not an upstream call', async () => {
    const t = fresh();
    mode = 'ok';
    const cold = await CatalogService.browse(PROFILE, 'series', {
      genre: t.genre,
    });
    assert.equal(cold.items[0].source, 'provider');

    // Trip the breaker on a different rail, so the cached one is never the thing that failed.
    mode = 'down';
    const tripGenre = fresh().genre;
    for (let i = 0; i < 5; i++) {
      await CatalogService.browse(PROFILE, 'movie', { genre: tripGenre });
    }
    assert.equal(getCircuitBreaker('cinemeta').state, 'OPEN');

    const hitsWhenOpen = hits;
    const { items } = await CatalogService.browse(PROFILE, 'series', {
      genre: t.genre,
    });

    assert.equal(
      items[0].source,
      'provider',
      'OPEN denied an answer already in hand',
    );
    assert.equal(hits, hitsWhenOpen, 'a cache hit went out to upstream');
  });
});

describe('HALF_OPEN admits one probe', () => {
  it('lets exactly one concurrent caller through while the others fast-fail', async () => {
    const cb = new CircuitBreaker('probe-test', {
      failureThreshold: 2,
      resetTimeoutMs: 20,
      callTimeoutMs: 5000,
    });
    for (let i = 0; i < 2; i++) {
      await cb.execute(async () => {
        throw new Error('down');
      }, 'fallback');
    }
    assert.equal(cb.state, 'OPEN');

    await new Promise((resolve) => setTimeout(resolve, 40));

    let probes = 0;
    const outcome = await Promise.all(
      [0, 1, 2].map((i) =>
        cb.execute(async () => {
          probes++;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return `probe-${i}`;
        }, 'fast-fail'),
      ),
    );

    assert.equal(probes, 1, `only one probe may reach upstream, ${probes} did`);
    assert.equal(outcome.filter((v) => v === 'fast-fail').length, 2);
    assert.equal(cb.state, 'CLOSED');
    assert.equal(cb.probeInFlight, false);
  });

  it('reopens on a probe that fails, and admits a fresh probe after it', async () => {
    const cb = new CircuitBreaker('probe-retry', {
      failureThreshold: 2,
      resetTimeoutMs: 20,
      callTimeoutMs: 5000,
    });
    for (let i = 0; i < 2; i++) {
      await cb.execute(async () => {
        throw new Error('down');
      }, 'fallback');
    }
    await new Promise((resolve) => setTimeout(resolve, 40));

    // This probe REJECTS. Resolving here would have tested the opposite of what the name says,
    // and would have proved nothing about what happens after a failed probe.
    assert.equal(
      await cb.execute(async () => {
        throw new Error('still down');
      }, 'fallback'),
      'fallback',
      'a rejected probe must hand back the fallback',
    );
    assert.equal(cb.state, 'OPEN', 'a failed probe must reopen the circuit');
    assert.equal(
      cb.probeInFlight,
      false,
      'the slot must be released after the probe',
    );

    // The circuit is OPEN and still cooling, so this must not reach the upstream at all.
    let reached = false;
    await cb.execute(async () => {
      reached = true;
      return 'back';
    }, 'fast-fail');
    assert.equal(reached, false, 'a cooling circuit let a call through');

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(await cb.execute(async () => 'back', 'fallback'), 'back');
    assert.equal(
      cb.state,
      'CLOSED',
      'a successful probe must close the circuit',
    );
  });
});

describe('CFLIX_CALL_TIMEOUT_MS is validated', () => {
  it('falls back to the default for a value that is not a positive number', () => {
    for (const raw of ['abc', '0', '-1', '', '  ', undefined, 'NaN', '1e']) {
      const budget = callTimeoutMs(raw);
      assert.ok(
        Number.isFinite(budget) && budget >= FLOOR_MS,
        `CFLIX_CALL_TIMEOUT_MS='${raw}' yielded ${budget}, under the ${FLOOR_MS}ms floor`,
      );
    }
  });

  it('floors at what the worst adapter legitimately costs, not at one request', () => {
    // 8000 is one upstream request, which is what every adapter declares as its own ceiling, but
    // `cinemeta.get` asks twice on a legitimate miss. A budget of 8000 therefore expires while a
    // healthy upstream is still answering: measured against a stub replying 200 after 5000ms, it
    // turned six legitimate misses into five recorded failures and left the circuit OPEN.
    //
    // Both sides are literals so this cannot pass by both sides drifting together.
    assert.equal(
      FLOOR_MS,
      16000,
      'the floor is 8000 per request times the two requests cinemeta.get makes',
    );
    for (const raw of ['1', '250', '8000', '16000']) {
      assert.equal(
        callTimeoutMs(raw),
        16000,
        `CFLIX_CALL_TIMEOUT_MS='${raw}' yielded ${callTimeoutMs(raw)}`,
      );
    }
  });

  it('honours a larger explicit budget', () => {
    assert.equal(callTimeoutMs('45000'), 45000);
  });

  it('is the value providerCall actually installs on the breaker', () => {
    // `getCircuitBreaker` applies options only on FIRST creation, so this must read the breaker
    // providerCall built rather than one a test pinned to class defaults. Both sides are literals
    // because comparing CALL_TIMEOUT_MS to itself would pass no matter what it was.
    assert.equal(getCircuitBreaker('cinemeta').callTimeoutMs, 20000);
    assert.equal(CALL_TIMEOUT_MS, 20000);
  });
});
