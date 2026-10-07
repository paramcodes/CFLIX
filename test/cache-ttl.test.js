/**
 * The TTL was not a deadline. `cache.get(key, loader)` carries a stale branch that serves the old
 * value and refreshes it behind the caller's back, but the only caller passed no loader, so
 * `loaders` was permanently empty, `refresh` was unreachable and BOTH branches of `get` returned
 * the stored value. Measured against origin/main with a 50ms TTL:
 *
 *   t=0ms    get -> ["value"]
 *   t=300ms  get -> ["value"]     <- 6x past expiry, still served
 *
 * and `CFLIX_CACHE_TTL_MS=0` made it worse rather than better: 0 fell through the `>= 0` guard
 * into the expired branch, which returned the value anyway, so the one value an operator would
 * never choose meant "cache forever and never revalidate".
 *
 * What is asserted here, against the real `CatalogService` and the real cache over a local stub,
 * so nothing needs the internet:
 *   - an entry past the TTL is served as a stale value WITHOUT making the caller wait on upstream,
 *     and the refresh then lands, so the next read is the new value
 *   - a refresh that finds the upstream down is counted by the breaker and does not overwrite the
 *     entry with the outage's fallback
 *   - `CFLIX_CACHE_TTL_MS=0` persists nothing and serves nothing, rather than caching forever
 *   - the directory stops growing: search is keyed on the query string and Cinemeta answers every
 *     query with its whole top catalog, so unbounded distinct queries meant unbounded files
 */
import { afterAll, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** Short enough to wait for, long enough that a warm read inside it is not a race. */
const TTL_MS = 150;

/** Stub requests: the only instrument that proves a read reached upstream, and when. */
let hits = 0;
/** Bumped per request, so a stale value and a refreshed one are told apart by their TITLE. */
let revision = 0;
/** Genres the stub answers 503 for, which is how one refresh sees a dead upstream. */
const failing = new Set();

const stub = createServer((req, res) => {
  hits++;
  revision++;
  const answered = revision;
  const path = req.url.split('?')[0];
  const genre = path.match(/\/genre=([^/]+)\.json$/)?.[1] ?? '';
  if (failing.has(genre)) {
    res.writeHead(503, { 'content-type': 'application/json' });
    return res.end('{"error":"upstream unavailable"}');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      metas: [
        {
          id: 'tt9000001',
          type: 'movie',
          name: `${genre} revision ${answered}`,
          genres: genre ? [genre] : [],
        },
      ],
    }),
  );
});

const stubPort = await new Promise((resolve, reject) => {
  stub.once('error', reject);
  stub.listen(0, '127.0.0.1', () => resolve(stub.address().port));
});

// Read once at import by the adapter, the cache and the store, so this has to precede the
// dynamic imports below.
process.env.CINEMETA_BASE = `http://127.0.0.1:${stubPort}`;
process.env.CFLIX_CACHE_DIR = mkdtempSync(
  join(tmpdir(), 'cflix-cache-ttl-test-'),
);
process.env.CFLIX_CACHE_TTL_MS = String(TTL_MS);
process.env.CFLIX_DB_PATH = ':memory:';

const { CatalogService } = await import('../server/src/catalog.js');
const { createCacheStore } = await import('../server/src/providers/cache.js');
const { cacheKey } = await import('../server/src/providers/contract.js');
const { db } = await import('../server/src/store.js');
const { getCircuitBreaker, resetAllCircuitBreakers } =
  await import('../server/src/resilience/circuit-breaker.js');

const PROFILE = 'p_cache_ttl_test';
db.profiles.set(PROFILE, {
  id: PROFILE,
  accountId: 'u_cache_ttl_test',
  name: 'Adult',
  maturity: 'adult',
});

const scratchDir = () => mkdtempSync(join(tmpdir(), 'cflix-cache-ttl-unit-'));
const files = (dir) =>
  readdirSync(dir).filter((name) => name.endsWith('.json'));

/** Polls until `ok`, so a background refresh is awaited rather than slept for. */
async function eventually(ok, what) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await ok()) return;
    await sleep(10);
  }
  assert.fail(typeof what === 'function' ? what() : what);
}

describe('an expired entry is served stale and refreshed behind the caller', () => {
  beforeEach(() => {
    hits = 0;
    revision = 0;
    resetAllCircuitBreakers();
  });

  afterAll(() => {
    stub.close();
    rmSync(process.env.CFLIX_CACHE_DIR, { recursive: true, force: true });
  });

  it('returns the stale value without waiting, then lands the refresh', async () => {
    const genre = 'CacheDrift';
    const first = await CatalogService.browse(PROFILE, 'movie', { genre });
    assert.deepEqual(
      first.items.map((item) => [item.id, item.title, item.source]),
      [['tt9000001', `${genre} revision 1`, 'provider']],
      'the first read must reach upstream and answer from the provider',
    );
    assert.equal(hits, 1);

    await sleep(TTL_MS * 2);

    const stale = await CatalogService.browse(PROFILE, 'movie', { genre });
    assert.deepEqual(
      stale.items.map((item) => item.title),
      [`${genre} revision 1`],
      'a read past the TTL must answer with the value it has rather than an empty rail',
    );
    assert.equal(
      hits,
      1,
      'the caller waited on upstream for a value the cache already had, which is the latency ' +
        'spike stale-while-revalidate exists to avoid',
    );

    // The loader the caller registered is the only thing that can land the new value, and `get`
    // schedules it. If catalog.js hands `cache.get` no loader nothing runs here at all, and the
    // entry stays what it was written as until the process dies. The served value is the
    // observable to wait on, not the hit count: the upstream hit lands before the refreshed
    // entry is written, so waiting on `hits` races the `put` and the read below can still be
    // answered by the old value.
    await eventually(
      async () =>
        (await CatalogService.browse(PROFILE, 'movie', { genre })).items[0]
          ?.title === `${genre} revision 2`,
      () =>
        `no refresh landed for an expired entry after ${hits} upstream reads, so the TTL serves the same value forever`,
    );

    const fresh = await CatalogService.browse(PROFILE, 'movie', { genre });
    assert.deepEqual(
      fresh.items.map((item) => item.title),
      [`${genre} revision 2`],
      'the read after the refresh must answer with the refreshed value',
    );
    assert.equal(
      hits,
      2,
      'a refreshed entry is served from the cache rather than fetched a third time',
    );
  });

  it('counts a refresh that finds the upstream down and keeps the stale entry', async () => {
    const genre = 'CacheOutage';
    await CatalogService.browse(PROFILE, 'movie', { genre });
    assert.equal(hits, 1);

    failing.add(genre);
    try {
      await sleep(TTL_MS * 2);
      const stale = await CatalogService.browse(PROFILE, 'movie', { genre });
      assert.deepEqual(
        stale.items.map((item) => item.title),
        [`${genre} revision 1`],
        'an expired entry must answer with its own value while its refresh is in flight',
      );

      // An unguarded refresh would re-hit a dead upstream on every TTL and the circuit would
      // never see the outage, which is what PR #70 exists to prevent.
      await eventually(
        () => getCircuitBreaker('cinemeta').getStatus().consecutiveFailures > 0,
        () =>
          `a refresh against a 503 upstream recorded ${getCircuitBreaker('cinemeta').getStatus().consecutiveFailures} failures, so it never reached upstream`,
      );
    } finally {
      failing.delete(genre);
    }

    // The 503 made the loader resolve the fallback, and a fallback must never be persisted: an
    // empty list cached for the TTL would suppress the seed fallback on every later read.
    const after = await CatalogService.browse(PROFILE, 'movie', { genre });
    assert.deepEqual(
      after.items.map((item) => [item.source, item.title.length > 0]),
      [['provider', true]],
      'the outage left the last good value in place rather than replacing the entry',
    );
  });
});

describe('CFLIX_CACHE_TTL_MS=0 means no cache, not cache forever', () => {
  it('persists nothing and serves nothing', async () => {
    const dir = scratchDir();
    process.env.CFLIX_CACHE_DIR = dir;
    process.env.CFLIX_CACHE_TTL_MS = '0';
    try {
      const off = createCacheStore();
      await off.put('cinemeta:get:tt1', { id: 'tt1' });
      assert.deepEqual(
        files(dir),
        [],
        'a TTL of 0 still wrote a file, so an operator asking for no cache gets a permanent one',
      );
      assert.equal(await off.get('cinemeta:get:tt1'), null);

      // A file another store wrote is still not served by a disabled one.
      const writer = createCacheStore({ dir, ttlMs: 60_000 });
      await writer.put('cinemeta:get:tt1', { id: 'tt1' });
      assert.equal(
        await off.get('cinemeta:get:tt1'),
        null,
        'a disabled store served an entry already past its 0ms TTL',
      );
      assert.deepEqual(
        await writer.get('cinemeta:get:tt1'),
        { id: 'tt1' },
        'disabling the cache for one store disabled it for another',
      );
    } finally {
      delete process.env.CFLIX_CACHE_DIR;
      delete process.env.CFLIX_CACHE_TTL_MS;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a blank setting at the default rather than reading it as 0', async () => {
    const dir = scratchDir();
    process.env.CFLIX_CACHE_DIR = dir;
    process.env.CFLIX_CACHE_TTL_MS = '   ';
    try {
      const store = createCacheStore();
      await store.put('cinemeta:get:tt2', { id: 'tt2' });
      assert.deepEqual(
        await store.get('cinemeta:get:tt2'),
        { id: 'tt2' },
        'an unset TTL must behave like the default TTL, not like a disabled cache',
      );
    } finally {
      delete process.env.CFLIX_CACHE_DIR;
      delete process.env.CFLIX_CACHE_TTL_MS;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the cache directory does not grow without bound', () => {
  it('evicts the oldest entries once the cap is passed', async () => {
    const dir = scratchDir();
    const maxEntries = 5;
    const store = createCacheStore({ dir, ttlMs: 60_000, maxEntries });
    const keyFor = (n) => cacheKey('cinemeta', 'search', 'all', `term ${n}`);
    try {
      // One sleep between writes so the mtimes the sweep orders by are distinguishable, which is
      // what lets the assertion below name WHICH entries survive.
      for (let n = 0; n < 40; n++) {
        await store.put(keyFor(n), {
          items: Array.from({ length: 100 }, (_, i) => `t${n}-${i}`),
        });
        await sleep(2);
      }
      await eventually(
        () => files(dir).length <= maxEntries,
        () =>
          `the directory held ${files(dir).length} files against a cap of ${maxEntries}, so nothing evicts`,
      );
      assert.deepEqual(
        await store.get(keyFor(39)),
        { items: Array.from({ length: 100 }, (_, i) => `t39-${i}`) },
        'the sweep evicted the entry written last instead of the oldest ones',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a directory under the cap alone', async () => {
    const dir = scratchDir();
    const store = createCacheStore({ dir, ttlMs: 60_000, maxEntries: 50 });
    try {
      for (let n = 0; n < 10; n++) {
        await store.put(cacheKey('cinemeta', 'browse', 'movie', `-${n}`), {
          n,
        });
      }
      await sleep(50);
      assert.equal(
        files(dir).length,
        10,
        'the sweep deleted entries below the cap',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
