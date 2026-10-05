#!/usr/bin/env node
/**
 * Asserts a provider episode carries its owning series' maturity, through the CINEMETA_BASE
 * seam the adapter already reads, so the provider path runs against a stub instead of upstream.
 *
 * The stub series is rated adult, so each episode ref is a 200 for an adult profile and a 404 for
 * a child one. That second assertion is what stops a fix which simply dropped the gate from
 * reading as a pass.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as reservePort } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SERIES_ID = 'tt0000001';
const EPISODE_IDS = [`${SERIES_ID}:1:1`, `${SERIES_ID}:1:2`];
const STUB_META = {
  meta: {
    id: SERIES_ID,
    imdb_id: SERIES_ID,
    type: 'series',
    name: 'Stub Series',
    description: 'A series invented by the maturity check.',
    poster: 'https://example.test/poster.jpg',
    background: 'https://example.test/background.jpg',
    logo: 'https://example.test/logo.png',
    genres: ['Horror'],
    releaseInfo: '2021',
    runtime: '45 min',
    imdbRating: '8.1',
    videos: EPISODE_IDS.map((id, index) => ({
      id,
      season: 1,
      number: index + 1,
      name: `Episode ${index + 1}`,
      overview: `Synopsis ${index + 1}.`,
      thumbnail: `https://example.test/${index + 1}.jpg`,
    })),
  },
};

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

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = reservePort();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitFor(base) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(base + '/')).status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no server on ${base}`);
}

async function stubUpstream() {
  const requested = [];
  const server = createServer((req, res) => {
    requested.push(req.url);
    if (req.url === `/meta/series/${SERIES_ID}.json`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(STUB_META));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ meta: null }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    requested,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function client(base) {
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
  return {
    get: (path, token, profileId) => call('GET', path, null, token, profileId),
    post: (path, body, token, profileId) =>
      call('POST', path, body, token, profileId),
  };
}

const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const email = `episode-maturity-${stamp}@test.dev`;

const stub = await stubUpstream();
const port = await freePort();
const cacheDir = mkdtempSync(join(tmpdir(), 'cflix-maturity-'));
const app = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(port),
    PROVIDER: 'cinemeta',
    CINEMETA_BASE: stub.base,
    CFLIX_CACHE_DIR: cacheDir,
  },
  stdio: 'ignore',
});

try {
  const base = `http://localhost:${port}`;
  await waitFor(base);
  const api = client(base);

  const signedUp = await api.post('/api/auth/signup', {
    email,
    password: 'pw123',
  });
  const token = signedUp.data.session.token;
  const profiles = {};
  for (const maturity of ['adult', 'child']) {
    const created = await api.post(
      '/api/profiles',
      { name: `${maturity}-${stamp}`, maturity },
      token,
    );
    profiles[maturity] = created.data.id;
  }

  console.log(`stub upstream  ${stub.base}  series=${SERIES_ID}`);

  console.log('\n== the series resolves and is visible to an adult');
  const series = await api.get(
    `/api/catalog/get?id=${SERIES_ID}`,
    token,
    profiles.adult,
  );
  check('series resolves', series.status, 200);
  check('series is rated adult', series.data.maturity, 'adult');
  check('series carries both episodes', series.data.episodes?.length, 2);

  console.log('\n== an episode ref resolves the same way play already did');
  const play = await api.post(
    '/api/play',
    { ref: { kind: 'episode', id: EPISODE_IDS[0] } },
    token,
    profiles.adult,
  );
  check('play resolves the episode', play.data.item?.id, EPISODE_IDS[0]);

  for (const id of EPISODE_IDS) {
    console.log(`\n== GET get?id=${id}`);
    const adult = await api.get(
      `/api/catalog/get?id=${id}`,
      token,
      profiles.adult,
    );
    check('an adult profile gets the episode', adult.status, 200);
    check('the episode is the one asked for', adult.data.id, id);
    check('the episode names its series', adult.data.seriesId, SERIES_ID);
    check(
      'the episode inherits its series maturity',
      adult.data.maturity,
      'adult',
    );
  }

  console.log('\n== the gate still refuses a child profile');
  const child = await api.get(
    `/api/catalog/get?id=${EPISODE_IDS[0]}`,
    token,
    profiles.child,
  );
  check('a child profile is refused the adult episode', child.status, 404);
  check(
    'the refusal does not name the title',
    child.data.error?.message,
    'no such title',
  );

  check(
    'every upstream read went to the stub, and it was read at all',
    [...new Set(stub.requested)].sort(),
    [`/meta/series/${SERIES_ID}.json`],
  );
} finally {
  app.kill();
  await stub.close();
}

console.log(`\n${checks - failures} PASS, ${failures} FAIL, ${checks} checks`);
process.exit(failures ? 1 : 0);
