#!/usr/bin/env node
/**
 * Drives the real CFLIX API over plain HTTP and asserts against literal values.
 *
 * The smoke test pins the seed fixture. This proves the provider path: that a rail carries real
 * artwork, that both id namespaces resolve, and that a child profile never sees an adult title.
 *
 * `node scripts/integration-check.mjs` starts its own servers, so it needs no running instance.
 * Pass BASE or PORT to reuse one for the live cases; the offline case always starts its own.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, startServerForRun } from './verify/harness.mjs';

const stamp = `${Date.now()}`;
const EMAIL = `integration-${stamp}@test.dev`;
const PASSWORD = 'pw123';

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

function truthy(label, actual, detail) {
  checks++;
  const ok = Boolean(actual);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}\n        got      ${JSON.stringify(detail ?? actual)}`,
  );
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

async function signUp(base) {
  const api = client(base);
  const res = await api.post('/api/auth/signup', {
    email: EMAIL,
    password: PASSWORD,
  });
  if (!res.data.session?.token) throw new Error('signup failed');
  const token = res.data.session.token;
  const profiles = {};
  for (const maturity of ['adult', 'child']) {
    const created = await api.post(
      '/api/profiles',
      { name: `${maturity}-${stamp}`, maturity },
      token,
    );
    profiles[maturity] = created.data.id;
  }
  return { api, token, ...profiles };
}

async function liveChecks(base) {
  const { api, token, adult, child } = await signUp(base);

  console.log('\n== browse movies (provider, adult profile)');
  const browse = await api.get('/api/catalog/browse?kind=movie', token, adult);
  truthy(
    'browse returns items',
    browse.data.items.length > 0,
    browse.data.items.length,
  );
  check(
    'every item has a non-empty title',
    browse.data.items.filter((i) => !i.title).map((i) => i.id),
    [],
  );
  check(
    'every item has a posterUrl',
    browse.data.items.filter((i) => !i.posterUrl).map((i) => i.id),
    [],
  );
  check(
    'every item has a backdropUrl',
    browse.data.items.filter((i) => !i.backdropUrl).map((i) => i.id),
    [],
  );
  check(
    'every year is a number',
    browse.data.items
      .filter((i) => typeof i.year !== 'number')
      .map((i) => `${i.id}:${i.year}`),
    [],
  );
  check(
    'every item is stamped provider',
    [...new Set(browse.data.items.map((i) => i.source))],
    ['provider'],
  );
  console.log(
    `        sample     ${JSON.stringify(
      browse.data.items.slice(0, 2).map((i) => ({
        id: i.id,
        title: i.title,
        year: i.year,
        maturity: i.maturity,
        posterUrl: i.posterUrl,
      })),
      null,
      0,
    )}`,
  );

  console.log('\n== browse?genre=Action');
  const action = await api.get(
    '/api/catalog/browse?kind=movie&genre=Action',
    token,
    adult,
  );
  truthy(
    'genre rail is not empty',
    action.data.items.length > 0,
    action.data.items.length,
  );
  check(
    'every item carries the requested genre',
    action.data.items
      .filter((i) => !i.genres.map((g) => g.toLowerCase()).includes('action'))
      .map((i) => i.id),
    [],
  );
  console.log(
    `        titles     ${JSON.stringify(action.data.items.slice(0, 3).map((i) => `${i.title} [${i.genres.join('/')}]`))}`,
  );

  console.log('\n== get, both id namespaces');
  const providerMovie = await api.get(
    '/api/catalog/get?id=tt0111161',
    token,
    adult,
  );
  check('provider movie id resolves', providerMovie.data.id, 'tt0111161');
  check(
    'provider movie title',
    providerMovie.data.title,
    'The Shawshank Redemption',
  );
  check('provider movie year', providerMovie.data.year, 1994);
  check(
    'provider movie durationSeconds',
    providerMovie.data.durationSeconds,
    8520,
  );
  check('provider movie source', providerMovie.data.source, 'provider');

  const seedMovie = await api.get('/api/catalog/get?id=seed:m1', token, adult);
  check('legacy seed id still resolves', seedMovie.data.id, 'seed:m1');
  check('legacy seed title', seedMovie.data.title, 'The Dark Knight');
  check('legacy seed source', seedMovie.data.source, 'seed');

  const seedEpisode = await api.get(
    '/api/catalog/get?id=seed:s1:1:1',
    token,
    adult,
  );
  check('legacy seed episode id resolves', seedEpisode.data.id, 'seed:s1:1:1');
  check(
    'a seed episode inherits its series maturity',
    seedEpisode.data.maturity,
    'teen',
  );
  const seedEpisodeForChild = await api.get(
    '/api/catalog/get?id=seed:s1:1:1',
    token,
    child,
  );
  check(
    'a teen seed episode is hidden from a child',
    seedEpisodeForChild.status,
    404,
  );
  const seedSeries = await api.get('/api/catalog/get?id=seed:s1', token, adult);
  check('legacy seed series id resolves', seedSeries.data.title, 'Dark');

  const namespaced = await api.get(
    '/api/catalog/get?id=kitsu:1555',
    token,
    adult,
  );
  check('namespaced provider id resolves', namespaced.data.id, 'kitsu:1555');
  check(
    'namespaced provider id came from Kitsu',
    namespaced.data.provider,
    'kitsu',
  );

  console.log('\n== search');
  const dark = await api.post(
    '/api/catalog/search',
    { text: 'dark' },
    token,
    adult,
  );
  truthy(
    'search dark returns items',
    dark.data.items.length > 0,
    dark.data.items.length,
  );
  check(
    'every result title contains "dark" case-insensitively',
    dark.data.items
      .filter((i) => !i.title.toLowerCase().includes('dark'))
      .map((i) => i.title),
    [],
  );
  console.log(
    `        titles     ${JSON.stringify(dark.data.items.map((i) => `${i.title} (${i.source})`))}`,
  );

  const anime = await api.post(
    '/api/catalog/search',
    { text: 'naruto', kind: 'anime' },
    token,
    adult,
  );
  truthy(
    'anime search returns items',
    anime.data.items.length > 0,
    anime.data.items.length,
  );
  check(
    'every anime result came from Kitsu',
    [...new Set(anime.data.items.map((i) => i.provider))],
    ['kitsu'],
  );
  check(
    'every anime title contains "naruto"',
    anime.data.items
      .filter((i) => !i.title.toLowerCase().includes('naruto'))
      .map((i) => i.title),
    [],
  );
  console.log(
    `        sample     ${JSON.stringify(anime.data.items.slice(0, 3).map((i) => `${i.id} ${i.title} (${i.maturity})`))}`,
  );

  const paged = await api.post(
    '/api/catalog/search',
    { text: 'naruto', kind: 'anime', limit: 5 },
    token,
    adult,
  );
  check('limit caps the page', paged.data.items.length, 5);
  check('nextCursor advances past the page', paged.data.nextCursor, '5');
  const second = await api.post(
    '/api/catalog/search',
    { text: 'naruto', kind: 'anime', limit: 5, cursor: paged.data.nextCursor },
    token,
    adult,
  );
  truthy(
    'cursor returns a disjoint page',
    second.data.items.every(
      (i) => !paged.data.items.some((p) => p.id === i.id),
    ),
    second.data.items.map((i) => i.id),
  );

  console.log('\n== the profile gate');
  const childBrowse = await api.get('/api/catalog/browse', token, child);
  truthy(
    'child browse is not empty (gate is non-vacuous)',
    childBrowse.data.items.length > 0,
    childBrowse.data.items.length,
  );
  check(
    'child browse holds zero adult titles',
    childBrowse.data.items
      .filter((i) => i.maturity === 'adult')
      .map((i) => `${i.id}:${i.title}`),
    [],
  );
  console.log(
    `        child sees ${JSON.stringify(childBrowse.data.items.map((i) => `${i.title} (${i.maturity})`))}`,
  );

  const childSearch = await api.post(
    '/api/catalog/search',
    { text: '' },
    token,
    child,
  );
  truthy(
    'child search is not empty (gate is non-vacuous)',
    childSearch.data.items.length > 0,
    childSearch.data.items.length,
  );
  check(
    'child search holds zero adult titles',
    childSearch.data.items
      .filter((i) => i.maturity === 'adult')
      .map((i) => `${i.id}:${i.title}`),
    [],
  );
  console.log(
    `        child sees ${JSON.stringify(childSearch.data.items.map((i) => `${i.title} (${i.maturity})`))}`,
  );

  const childAnimation = await api.get(
    '/api/catalog/browse?kind=movie&genre=Animation',
    token,
    child,
  );
  truthy(
    'child animation rail is not empty',
    childAnimation.data.items.length > 0,
    childAnimation.data.items.length,
  );
  check(
    'child animation rail holds zero adult titles',
    childAnimation.data.items
      .filter((i) => i.maturity === 'adult')
      .map((i) => i.title),
    [],
  );

  const blocked = await api.get('/api/catalog/get?id=seed:m4', token, child);
  check('child is 404 on an adult seed title', blocked.status, 404);
  check(
    'child gets no detail about the adult title',
    blocked.data.error?.message,
    'no such title',
  );

  console.log('\n== related');
  for (const [id, kind] of [
    ['tt0111161', 'movie'],
    ['tt5753856', 'series'],
    ['seed:m1', 'movie'],
  ]) {
    const res = await api.get(`/api/catalog/related?id=${id}`, token, adult);
    truthy(
      `related ${id} is not empty`,
      res.data.items.length > 0,
      res.data.items.length,
    );
    check(
      `related ${id} is all ${kind}`,
      [...new Set(res.data.items.map((i) => i.kind))],
      [kind],
    );
    check(
      `related ${id} excludes the anchor`,
      res.data.items.filter((i) => i.id === id).map((i) => i.id),
      [],
    );
    console.log(
      `        ${id} -> ${JSON.stringify(res.data.items.slice(0, 3).map((i) => i.title))}`,
    );
  }

  console.log('\n== play');
  const seriesPlay = await api.post(
    '/api/play',
    { ref: { kind: 'series', id: 'tt5753856' } },
    token,
    adult,
  );
  truthy(
    'series play resolved',
    seriesPlay.data.item?.id,
    seriesPlay.data.item?.id,
  );
  check(
    'series play did not return the series',
    seriesPlay.data.item.id !== 'tt5753856',
    true,
  );
  check(
    'the resolved episode is episode 1',
    seriesPlay.data.item.episodeNumber,
    1,
  );
  check(
    'the resolved episode belongs to the series',
    seriesPlay.data.item.seriesId,
    'tt5753856',
  );
  truthy(
    'series play returned an episode id',
    seriesPlay.data.item.id.startsWith('tt5753856'),
    seriesPlay.data.item.id,
  );
  truthy(
    'episode carries a duration',
    seriesPlay.data.item.durationSeconds > 0,
    seriesPlay.data.item.durationSeconds,
  );
  console.log(
    `        episode    ${JSON.stringify({
      id: seriesPlay.data.item.id,
      title: seriesPlay.data.item.title,
      season: seriesPlay.data.item.seasonNumber,
      number: seriesPlay.data.item.episodeNumber,
      durationSeconds: seriesPlay.data.item.durationSeconds,
      manifestUrl: seriesPlay.data.manifestUrl,
    })}`,
  );

  await api.post(
    '/api/progress',
    { itemId: seriesPlay.data.item.id, seconds: 90 },
    token,
    adult,
  );
  const secondPlay = await api.post(
    '/api/play',
    { ref: { kind: 'series', id: 'tt5753856' } },
    token,
    adult,
  );
  truthy(
    'second play advances past the watched episode',
    secondPlay.data.item.id !== seriesPlay.data.item.id,
    `${seriesPlay.data.item.id} -> ${secondPlay.data.item.id}`,
  );

  const moviePlay = await api.post(
    '/api/play',
    { ref: { kind: 'movie', id: 'tt0111161' } },
    token,
    adult,
  );
  check('provider movie play id', moviePlay.data.item.id, 'tt0111161');
  check(
    'provider movie play durationSeconds',
    moviePlay.data.item.durationSeconds,
    8520,
  );
  check(
    'provider movie manifestUrl',
    moviePlay.data.manifestUrl,
    '/stream/tt0111161.m3u8',
  );

  const seedPlay = await api.post(
    '/api/play',
    { ref: { kind: 'series', id: 'seed:s1' } },
    token,
    adult,
  );
  check(
    'seed series play still resolves seed:s1:1:1',
    seedPlay.data.item.id,
    'seed:s1:1:1',
  );

  const history = await api.get('/api/history', token, adult);
  truthy(
    'history holds the played episode',
    history.data.items.length > 0,
    history.data.items.length,
  );
  check(
    'history resolved the provider episode from cache',
    history.data.items[0].item?.id,
    seriesPlay.data.item.id,
  );
}

async function offlineCheck() {
  console.log('\n== offline fallback (PROVIDER=off)');
  const cacheDir = mkdtempSync(join(tmpdir(), 'cflix-offline-'));
  const server = await startServer({
    PROVIDER: 'off',
    CFLIX_CACHE_DIR: cacheDir,
  });
  try {
    const base = server.baseUrl;
    const { api, token, adult } = await signUp(base);
    const res = await api.get('/api/catalog/browse', token, adult);
    check(
      'browse falls back to the seed ids',
      res.data.items.map((i) => i.id),
      ['seed:m1', 'seed:m2', 'seed:m3', 'seed:m4', 'seed:s1', 'seed:s2'],
    );
    check(
      'every fallback item is stamped seed',
      [...new Set(res.data.items.map((i) => i.source))],
      ['seed'],
    );
    const title = await api.get('/api/catalog/get?id=seed:m1', token, adult);
    check(
      'get still resolves a seed with no provider',
      title.data.title,
      'The Dark Knight',
    );
    const played = await api.post(
      '/api/play',
      { ref: { kind: 'series', id: 'seed:s1' } },
      token,
      adult,
    );
    check(
      'play still resolves a seed episode with no provider',
      played.data.item.id,
      'seed:s1:1:1',
    );
    console.log(
      `        titles     ${JSON.stringify(res.data.items.map((i) => i.title))}`,
    );
  } finally {
    server.stop();
  }
}

const liveBase = await startServerForRun();
console.log(`integration-check  account=${EMAIL}`);
await liveChecks(liveBase);
await offlineCheck();

console.log(`\n${checks - failures} PASS, ${failures} FAIL, ${checks} checks`);
process.exit(failures ? 1 : 0);
