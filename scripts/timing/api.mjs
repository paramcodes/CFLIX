/**
 * Server response timings for the routes a browser waits on.
 *
 * Cold and warm are separate measurements, not one distribution with a min and a max.
 * A cold sample empties the cache directory first, so it pays a full upstream round trip.
 * A warm sample reuses a primed cache, so it pays a file read. Averaging the two would
 * report a number no user ever sees.
 */
import { bootServer, signIn, timed } from './boot.mjs';
import { summarize } from './stats.mjs';

/**
 * A query Cinemeta answers and the offline fixture does not. A seed match short-circuits
 * the provider entirely, so `dark` measures the fixture and not the network.
 */
const PROVIDER_QUERY = 'matrix';
const SEED_QUERY = 'dark';

/**
 * @param {{coldRuns?: number, warmRuns?: number}} options
 *   `coldRuns` defaults to 5 because each one is a live upstream call, and 5 is the smallest
 *   count that yields a real median. `warmRuns` defaults to 20 because a warm call is a
 *   local file read: more samples cost almost nothing and tighten the median of the number
 *   that will actually gate.
 */
export async function measureApi({ coldRuns = 5, warmRuns = 20 } = {}) {
  const server = await bootServer();
  const auth = await signIn(server.baseUrl);
  const base = {
    baseUrl: server.baseUrl,
    token: auth.token,
    profileId: auth.profile.id,
  };

  const routes = [
    {
      label: 'GET /api/catalog/browse?kind=movie',
      run: () => timed({ ...base, path: '/api/catalog/browse?kind=movie' }),
    },
    {
      label: 'GET /api/catalog/browse?kind=series',
      run: () => timed({ ...base, path: '/api/catalog/browse?kind=series' }),
    },
    {
      label: `POST /api/catalog/search {"text":"${PROVIDER_QUERY}"}`,
      run: () =>
        timed({
          ...base,
          method: 'POST',
          path: '/api/catalog/search',
          body: { text: PROVIDER_QUERY, kind: 'movie' },
        }),
    },
    {
      label: `POST /api/catalog/search {"text":"${SEED_QUERY}"} fixture`,
      run: () =>
        timed({
          ...base,
          method: 'POST',
          path: '/api/catalog/search',
          body: { text: SEED_QUERY, kind: 'series' },
        }),
    },
  ];

  try {
    /**
     * The detail id is read from a live browse rather than hardcoded. A fixed Cinemeta id
     * rots, and a 404 would report itself as a very fast endpoint.
     */
    const moviePage = await timed({
      ...base,
      path: '/api/catalog/browse?kind=movie',
    });
    const liveId = (
      await fetch(`${server.baseUrl}/api/catalog/browse?kind=movie`, {
        headers: {
          authorization: `Bearer ${auth.token}`,
          'x-cflix-profile': auth.profile.id,
        },
      }).then((r) => r.json())
    ).items?.[0]?.id;
    routes.push({
      label: 'GET /api/catalog/get?id=<live movie>',
      run: () =>
        timed({
          ...base,
          path: `/api/catalog/get?id=${encodeURIComponent(liveId)}`,
        }),
    });

    const results = [];
    for (const route of routes) {
      const coldSamples = [];
      let coldLast = null;
      for (let i = 0; i < coldRuns; i++) {
        server.clearCache();
        coldLast = await route.run();
        coldSamples.push(coldLast.ms);
      }

      // One untimed priming call, so the first warm sample does not pay the cold cost.
      await route.run();
      const warmSamples = [];
      let warmLast = null;
      for (let i = 0; i < warmRuns; i++) {
        warmLast = await route.run();
        warmSamples.push(warmLast.ms);
      }

      const cold = summarize(coldSamples);
      const warm = summarize(warmSamples);
      results.push({
        label: route.label,
        cold,
        warm,
        coldSamples,
        warmSamples,
        coldStatus: coldLast?.status,
        coldItems: coldLast?.items,
        status: warmLast?.status,
        items: warmLast?.items,
        sources: warmLast?.sources,
      });

      const line = (name, s) =>
        `    ${name} median ${s.median} ms, range ${s.min}-${s.max} ms (n=${s.n})`;
      process.stdout.write(
        `  ${route.label}\n${line('cold', cold)}\n${line('warm', warm)}\n`,
      );
    }

    return { liveId, browseItems: moviePage.items, results };
  } finally {
    await server.stop();
  }
}
