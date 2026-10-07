/**
 * The circuit breaker had to be able to open, and could not.
 *
 * Every adapter swallows an upstream failure and resolves `null`, which a list call flattens
 * to `[]` (`getJson` in cinemeta.js, `kit` in kitsu.js, tvmaze.js). The guarded call therefore
 * RESOLVED on every outage, so `execute` called `onSuccess` each time and a full outage cost
 * every request the adapter's whole retry budget while the circuit sat CLOSED forever. Measured
 * against origin/main: 10 simulated outages left the breaker at CLOSED with 0 failures recorded.
 *
 * Three things are asserted here, all against the real class or the real `CatalogService`:
 *   - an upstream outage opens the circuit, and once open it makes no further upstream request
 *   - HALF_OPEN admits exactly one probe, so recovery is not a thundering herd
 *   - a slow-but-successful read is not booked as a failure, because the budget now sits above
 *     the adapters' own timeout instead of below it
 *
 * The upstream is a local stub driven by `CINEMETA_BASE`, so nothing here needs the internet.
 */
import { afterAll, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** `TIMEOUT_MS` in cinemeta.js and `REQUEST_TIMEOUT_MS` in kitsu.js, the shipped ceiling. */
const ADAPTER_CEILING_MS = 8000;

/** `down` answers 503 like a sick CDN. `ok` answers a one-title catalog. */
let mode = 'down';
/** Every stub response waits this long, so a slow-but-healthy upstream is expressible. */
let delayMs = 0;
/** Stub requests: the only instrument that proves the breaker stopped reaching upstream. */
let hits = 0;

const STUB_MOVIE = {
  id: 'tt9000001',
  type: 'movie',
  name: 'Stub Feature',
  genres: [],
};
const STUB_SERIES = {
  id: 'tt9000002',
  type: 'series',
  name: 'Stub Signal',
  genres: [],
};

const stub = createServer((req, res) => {
  hits++;
  const send = () => {
    if (mode === 'down') {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end('{"error":"upstream unavailable"}');
    }
    const series = req.url.includes('/series/');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ metas: [series ? STUB_SERIES : STUB_MOVIE] }));
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

const { CatalogService } = await import('../server/src/catalog.js');
const { db } = await import('../server/src/store.js');
const { CircuitBreaker, getCircuitBreaker, resetAllCircuitBreakers } =
  await import('../server/src/resilience/circuit-breaker.js');

const PROFILE = 'p_circuit_test';
db.profiles.set(PROFILE, {
  id: PROFILE,
  accountId: 'u_circuit_test',
  name: 'Adult',
  maturity: 'adult',
});

describe('circuit breaker against a failing upstream', () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
    mode = 'down';
    hits = 0;
    delayMs = 0;
  });

  afterAll(() => {
    stub.close();
    rmSync(process.env.CFLIX_CACHE_DIR, { recursive: true, force: true });
  });

  it('opens after the threshold of real upstream outages, then stops calling upstream', async () => {
    // The first read creates the breaker, so this reads the instance providerCall configured
    // rather than a fresh one built with defaults.
    await CatalogService.browse(PROFILE, 'movie');
    const breaker = getCircuitBreaker('cinemeta');
    assert.equal(breaker.failureThreshold, 5);
    assert.equal(breaker.getStatus().state, 'CLOSED');
    assert.equal(breaker.getStatus().consecutiveFailures, 1);

    for (let i = 1; i < breaker.failureThreshold; i++) {
      await CatalogService.browse(PROFILE, 'movie');
    }

    assert.equal(breaker.state, 'OPEN');
    assert.equal(breaker.getStatus().consecutiveFailures, 5);

    const hitsWhenOpen = hits;
    assert.ok(hitsWhenOpen > 0, 'no upstream request was made at all');
    for (let i = 0; i < 3; i++) await CatalogService.browse(PROFILE, 'movie');
    assert.equal(hits, hitsWhenOpen, 'an OPEN circuit still reached upstream');
  });

  it('keeps the user-visible answer identical while the circuit is open', async () => {
    for (let i = 0; i < 5; i++) await CatalogService.browse(PROFILE, 'movie');

    const { items } = await CatalogService.browse(PROFILE, 'movie');
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
    // Longer than origin/main's 5000ms budget, well inside the budget this change ships, and
    // inside the adapter's own timeout, so the read succeeds. origin/main records it as a
    // failure and books the rail the next five requests share.
    mode = 'ok';
    delayMs = 5500;
    const { items } = await CatalogService.browse(PROFILE, 'series');

    const breaker = getCircuitBreaker('cinemeta');
    assert.ok(
      breaker.callTimeoutMs > ADAPTER_CEILING_MS,
      `budget ${breaker.callTimeoutMs}ms does not clear the adapter's own ${ADAPTER_CEILING_MS}ms`,
    );
    assert.equal(
      items[0].id,
      STUB_SERIES.id,
      'a slow read must still serve provider items',
    );
    assert.equal(breaker.getStatus().consecutiveFailures, 0);
    assert.equal(breaker.getStatus().state, 'CLOSED');
  }, 30000);

  it('serves a cached answer while OPEN, because a cache hit is not an upstream call', async () => {
    mode = 'ok';
    const cold = await CatalogService.browse(PROFILE, 'series');
    assert.equal(cold.items[0].id, STUB_SERIES.id);

    // Trip the breaker on a different rail, so the cached one is never the thing that failed.
    mode = 'down';
    for (let i = 0; i < 5; i++) await CatalogService.browse(PROFILE, 'movie');
    assert.equal(getCircuitBreaker('cinemeta').state, 'OPEN');

    const hitsWhenOpen = hits;
    const { items } = await CatalogService.browse(PROFILE, 'series');

    assert.equal(
      items[0].id,
      STUB_SERIES.id,
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

  it('admits a fresh probe after a failed one, rather than staying stuck', async () => {
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

    assert.equal(
      await cb.execute(async () => 'still down', 'fallback'),
      'still down',
    );
    assert.equal(cb.state, 'CLOSED');

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(await cb.execute(async () => 'back', 'fallback'), 'back');
    assert.equal(cb.state, 'CLOSED');
  });
});
