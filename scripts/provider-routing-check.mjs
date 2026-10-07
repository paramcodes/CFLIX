#!/usr/bin/env node
/**
 * Provider routing and the episode-ref grammar, asserted over HTTP against a stub upstream.
 *
 * Two shipped bugs sat in `server/src/catalog.js` and no gate could see either, because every
 * gate either answered from the fixture or reached the real internet. `PROVIDER=off` is no help
 * for the first: it only nulls the active provider, and a kind with a dedicated provider is
 * routed before that lookup happens, so the call still went out to an adapter. So this script
 * points both adapters at a local stub through the same env seam `CINEMETA_BASE` already provides,
 * which keeps the assertions hermetic and inside `npm test`.
 *
 *   - `browse?kind=anime` and `search` with `kind=anime` must both route to Kitsu. PR #47 shipped
 *     browse resolving a provider while only search consulted the kind table, so the anime rail
 *     answered with Cinemeta titles.
 *   - an episode ref must resolve to its owning title through the adapter that mints that ref, for
 *     the Cinemeta `tt...:<season>:<number>` shape and the Kitsu `kitsu:<id>:e<number>` shape.
 *     PR #39 shipped a resolver holding only Kitsu's shape, so a Cinemeta episode id was never
 *     reduced to its series and the maturity gate blocked every profile on that ref.
 *   - every adapter in `ADAPTER_ORDER` declares that shape, so a new one cannot ship an id format
 *     no caller can split.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADAPTER_ORDER } from '../server/src/providers/contract.js';

const ROOT = new URL('..', import.meta.url).pathname;
const EMAIL = `routing-${Date.now()}@test.dev`;
const PASSWORD = 'pw123';

/** Ids the stub mints. The tests assert on these literals, never on a count. */
const CINEMETA_SERIES = 'tt1844624';
const CINEMETA_EPISODE = `${CINEMETA_SERIES}:1:3`;
const KITSU_SERIES = '9001';
const KITSU_EPISODE = `kitsu:${KITSU_SERIES}:e55501`;

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}\n        got      ${JSON.stringify(actual)}` +
      (ok ? '' : `\n        expected ${JSON.stringify(expected)}`),
  );
}

const hits = { cinemeta: 0, kitsu: 0 };

const kitsuRecord = {
  id: KITSU_SERIES,
  type: 'anime',
  attributes: {
    canonicalTitle: 'Stub Voyage',
    synopsis: 'A record served by the stub upstream.',
    startDate: '2019-04-07',
    averageRating: '8.10',
    ageRating: 'PG-13',
    posterImage: { medium: 'https://example.test/poster.jpg' },
    coverImage: { large: 'https://example.test/cover.jpg' },
  },
  relationships: { genres: { data: [{ id: '1', type: 'genres' }] } },
};

const kitsuGenre = {
  id: '1',
  type: 'genres',
  attributes: { name: 'Animation' },
};

const kitsuEpisodeRecords = [
  {
    id: '55501',
    type: 'animeEpisode',
    attributes: { number: 1, canonicalTitle: 'Launch' },
  },
  {
    id: '55503',
    type: 'animeEpisode',
    attributes: { number: 3, canonicalTitle: 'Drift' },
  },
];

const cinemetaSeriesMeta = {
  id: CINEMETA_SERIES,
  type: 'series',
  name: 'Stub Signal',
  description: 'A series served by the stub upstream.',
  runtime: '45 min',
  poster: 'https://example.test/cm-poster.jpg',
  genres: ['Drama'],
  imdbRating: '7.9',
  videos: [
    {
      id: `${CINEMETA_SERIES}:1:1`,
      season: 1,
      number: 1,
      name: 'Carrier',
      overview: 'The first episode.',
    },
    {
      id: CINEMETA_EPISODE,
      season: 1,
      number: 3,
      name: 'Answer',
      overview: 'The third episode.',
    },
  ],
};

const cinemetaMovieMeta = {
  id: 'tt0000001',
  type: 'movie',
  name: 'Stub Feature',
  description: 'A movie served by the stub upstream.',
  runtime: '100 min',
  poster: 'https://example.test/cm-movie.jpg',
  genres: ['Drama'],
};

function stubUpstream(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname.startsWith('/kitsu/')) {
    hits.kitsu++;
    const path = url.pathname.slice('/kitsu'.length);
    if (path.startsWith(`/anime/${KITSU_SERIES}/episodes`)) {
      return send(200, { data: kitsuEpisodeRecords, meta: { count: 2 } });
    }
    if (path === `/anime/${KITSU_SERIES}`) {
      return send(200, { data: kitsuRecord, included: [kitsuGenre] });
    }
    if (path === '/anime') {
      return send(200, {
        data: [kitsuRecord],
        included: [kitsuGenre],
        meta: { count: 1 },
      });
    }
    return send(404, { errors: [{ detail: 'no such anime' }] });
  }

  if (url.pathname.startsWith('/cinemeta/')) {
    hits.cinemeta++;
    const path = url.pathname.slice('/cinemeta'.length);
    if (path === `/meta/series/${CINEMETA_SERIES}.json`) {
      return send(200, { meta: cinemetaSeriesMeta });
    }
    // The one honest upstream signal for a kind mismatch. Serving a movie here instead would let
    // `get` answer with the wrong title, which is the failure the stub exists to exclude.
    if (path === `/meta/movie/${CINEMETA_SERIES}.json`)
      return send(200, { meta: null });
    if (path === '/catalog/movie/top.json')
      return send(200, { metas: [cinemetaMovieMeta] });
    if (path === '/catalog/series/top.json') {
      return send(200, { metas: [cinemetaSeriesMeta] });
    }
    return send(404, { message: 'no such path' });
  }

  return send(404, { message: 'no such path' });
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function freePort() {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitFor(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server at ${url} did not answer within ${timeoutMs}ms`);
}

const ADAPTERS = {
  cinemeta: await import('../server/src/providers/cinemeta.js'),
  tvmaze: await import('../server/src/providers/tvmaze.js'),
  kitsu: await import('../server/src/providers/kitsu.js'),
};

check(
  'every adapter in ADAPTER_ORDER declares the episode-ref shape it mints',
  ADAPTER_ORDER.filter(
    (name) => typeof ADAPTERS[name]?.episodeOwnerId !== 'function',
  ),
  [],
);

const upstream = createServer(stubUpstream);
const upstreamBase = `http://127.0.0.1:${await listen(upstream)}`;
const cacheDirs = [];

/** Each server gets its own cache so one run cannot read another's entries. */
function cacheDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cflix-routing-cache-'));
  cacheDirs.push(dir);
  return dir;
}

/**
 * Boots a server pointed at the stub and hands the caller a request helper. `PROVIDER=off` reaches
 * no adapter at all, which is what makes the last two checks meaningful.
 */
async function withServer(env, fn) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CINEMETA_BASE: `${upstreamBase}/cinemeta`,
      KITSU_BASE: `${upstreamBase}/kitsu`,
      CFLIX_CACHE_DIR: cacheDir(),
      ...env,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, path, body, token, profileId) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (profileId) headers['x-cflix-profile'] = profileId;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try {
    await waitFor(`${base}/`);
    await fn(call);
  } finally {
    child.kill('SIGTERM');
  }
}

try {
  await withServer({ PROVIDER: 'cinemeta' }, async (call) => {
    const auth = await call('POST', '/api/auth/signup', {
      email: EMAIL,
      password: PASSWORD,
    });
    const token = auth.data.session.token;
    const adult = await call(
      'POST',
      '/api/profiles',
      { name: 'Adult', maturity: 'adult' },
      token,
    );
    const profileId = adult.data.id;
    check(
      'setup yields a token and an adult profile',
      [!!token, !!profileId],
      [true, true],
    );

    const movieRail = await call(
      'GET',
      '/api/catalog/browse?kind=movie',
      null,
      token,
      profileId,
    );
    check(
      'control: kind=movie reads the stub cinemeta adapter',
      movieRail.data.items.map((i) => [i.id, i.provider]),
      [['tt0000001', 'cinemeta']],
    );

    const animeRail = await call(
      'GET',
      '/api/catalog/browse?kind=anime',
      null,
      token,
      profileId,
    );
    check(
      'browse?kind=anime routes to kitsu',
      animeRail.data.items.map((i) => [i.id, i.provider]),
      [[`kitsu:${KITSU_SERIES}`, 'kitsu']],
    );

    const animeSearch = await call(
      'POST',
      '/api/catalog/search',
      { text: 'Stub Voyage', kind: 'anime' },
      token,
      profileId,
    );
    check(
      'search with kind=anime routes to kitsu',
      animeSearch.data.items.map((i) => [i.id, i.provider, i.source]),
      [[`kitsu:${KITSU_SERIES}`, 'kitsu', 'provider']],
    );

    const cinemetaPlay = await call(
      'POST',
      '/api/play',
      { ref: { kind: 'episode', id: CINEMETA_EPISODE } },
      token,
      profileId,
    );
    check(
      'play resolves a cinemeta episode ref to its episode',
      [cinemetaPlay.status, cinemetaPlay.data.item?.id],
      [200, CINEMETA_EPISODE],
    );

    const kitsuPlay = await call(
      'POST',
      '/api/play',
      { ref: { kind: 'episode', id: KITSU_EPISODE } },
      token,
      profileId,
    );
    check(
      'play resolves a kitsu episode ref to its episode',
      [kitsuPlay.status, kitsuPlay.data.item?.id],
      [200, KITSU_EPISODE],
    );

    const unknownRef = await call(
      'POST',
      '/api/play',
      { ref: { kind: 'episode', id: `${CINEMETA_SERIES}:9:9` } },
      token,
      profileId,
    );
    check(
      'a well-formed ref naming a missing episode is still not found',
      [unknownRef.status, unknownRef.data.error?.code],
      [404, 'NOT_FOUND'],
    );

    check(
      'both adapters were redirected to the stub upstream',
      [hits.cinemeta > 0, hits.kitsu > 0],
      [true, true],
    );

    const before = { ...hits };
    await withServer({ PROVIDER: 'off' }, async (off) => {
      const offAuth = await off('POST', '/api/auth/signup', {
        email: `${EMAIL}-off`,
        password: PASSWORD,
      });
      const offToken = offAuth.data.session.token;
      const offProfile = await off(
        'POST',
        '/api/profiles',
        { name: 'Adult', maturity: 'adult' },
        offToken,
      );
      const offRail = await off(
        'GET',
        '/api/catalog/browse?kind=anime',
        null,
        offToken,
        offProfile.data.id,
      );
      // Six literal 'seed' values, not `items.map(() => 'seed')`: mapping the actual passes on an
      // empty rail, and this is the only gate over the PR #47/#58 routing invariant. Six is
      // `seedBrowseItems`' whole fixture, so a partial rail fails too.
      check(
        'PROVIDER=off forces the fixture even for a kind-routed browse',
        offRail.data.items.map((i) => i.source),
        ['seed', 'seed', 'seed', 'seed', 'seed', 'seed'],
      );
    });
    check(
      'PROVIDER=off reached no adapter at all',
      [hits.cinemeta - before.cinemeta, hits.kitsu - before.kitsu],
      [0, 0],
    );
  });
} finally {
  upstream.close();
  for (const dir of cacheDirs) rmSync(dir, { recursive: true, force: true });
}

console.log(`\nRouting Summary: ${checks - failures} PASS, ${failures} FAIL`);
process.exit(failures ? 1 : 0);
