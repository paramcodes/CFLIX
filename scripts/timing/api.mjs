/**
 * Server response timings for the routes a browser waits on.
 *
 * Cold and warm are separate measurements, not one distribution with a min and a max.
 * A cold sample empties the cache directory first, so it pays a full upstream round trip.
 * A warm sample reuses a primed cache, so it pays a file read. Averaging the two would
 * report a number no user ever sees.
 *
 * Every route declares the `source` it must answer with, and a mismatch aborts the run.
 * `search` answers the offline fixture before it asks a provider, so a query that starts
 * matching a seed title would silently switch this row from the network to the fixture and
 * read as a large speedup rather than a different route.
 */
import { timingClient, timed } from './boot.mjs';
import { summarize } from './stats.mjs';

/** Answered by Cinemeta; the fixture has no title matching it. */
const PROVIDER_QUERY = 'matrix';
/** A fixture title, so this row measures the in-process fixture path. */
const SEED_QUERY = 'dark';

/**
 * @param {{coldRuns?: number, warmRuns?: number}} options
 *   `coldRuns` defaults to 5: each one is a live upstream call, and 5 is the smallest count
 *   that yields a real median. `warmRuns` defaults to 20 because a warm call is a local file
 *   read, so more samples cost almost nothing and tighten the number that can be gated.
 */
export async function measureApi({ coldRuns = 5, warmRuns = 20 } = {}) {
  const client = await timingClient();
  const { baseUrl, headers, clearCache, liveId } = client;

  const routes = [
    {
      label: 'GET /api/catalog/browse?kind=movie',
      expectSource: 'provider',
      run: (expectSource) =>
        timed({
          baseUrl,
          headers,
          path: '/api/catalog/browse?kind=movie',
          expectSource,
        }),
    },
    {
      label: 'GET /api/catalog/browse?kind=series',
      expectSource: 'provider',
      run: (expectSource) =>
        timed({
          baseUrl,
          headers,
          path: '/api/catalog/browse?kind=series',
          expectSource,
        }),
    },
    {
      label: `POST /api/catalog/search {"text":"${PROVIDER_QUERY}"}`,
      expectSource: 'provider',
      run: (expectSource) =>
        timed({
          baseUrl,
          headers,
          method: 'POST',
          path: '/api/catalog/search',
          body: { text: PROVIDER_QUERY, kind: 'movie' },
          expectSource,
        }),
    },
    {
      label: `POST /api/catalog/search {"text":"${SEED_QUERY}"}`,
      expectSource: 'seed',
      run: (expectSource) =>
        timed({
          baseUrl,
          headers,
          method: 'POST',
          path: '/api/catalog/search',
          body: { text: SEED_QUERY, kind: 'series' },
          expectSource,
        }),
    },
    {
      label: 'GET /api/catalog/get?id=<live movie>',
      expectSource: 'provider',
      run: (expectSource) =>
        timed({
          baseUrl,
          headers,
          path: `/api/catalog/get?id=${encodeURIComponent(liveId)}`,
          expectSource,
        }),
    },
  ];

  try {
    const results = [];
    for (const route of routes) {
      const run = () => route.run(route.expectSource);

      const coldSamples = [];
      let coldLast = null;
      for (let i = 0; i < coldRuns; i++) {
        clearCache();
        coldLast = await run();
        coldSamples.push(coldLast.ms);
      }

      // One untimed priming call, so the first warm sample does not pay the cold cost.
      await run();
      const warmSamples = [];
      let warmLast = null;
      for (let i = 0; i < warmRuns; i++) {
        warmLast = await run();
        warmSamples.push(warmLast.ms);
      }

      const cold = summarize(coldSamples);
      const warm = summarize(warmSamples);
      results.push({
        label: route.label,
        expectSource: route.expectSource,
        cold,
        warm,
        coldSamples,
        warmSamples,
        coldStatus: coldLast.status,
        warmStatus: warmLast.status,
        itemCount: warmLast.itemCount,
        sources: warmLast.sources,
      });

      const line = (name, s) =>
        `    ${name} median ${s.median} ms, range ${s.min}-${s.max} ms (n=${s.n})`;
      process.stdout.write(
        `  ${route.label}\n${line('cold', cold)}\n${line('warm', warm)}\n`,
      );
    }

    return { liveId, results };
  } finally {
    client.stop();
  }
}
