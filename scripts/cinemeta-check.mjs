#!/usr/bin/env node
/**
 * Proves the Cinemeta adapter against live upstream.
 *
 * Every case pins the upstream literal AND the value the adapter derives from it,
 * so a broken parse fails the check instead of restating a constant. Re-run after
 * any change to cinemeta.js: `node scripts/cinemeta-check.mjs`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cinemeta } from '../server/src/providers/cinemeta.js';
import { maturityOf } from '../server/src/providers/maturity.js';

const BASE = process.env.CINEMETA_BASE || 'https://v3-cinemeta.strem.io';
const EN_DASH = '–';
const HTML = /<\/?(p|i|b|u|em|strong|a|div|span|br|ul|li)\b/i;

let passed = 0;
const failures = [];

const sameValue = (a, b) => {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

function check(label, actual, expected) {
  if (sameValue(actual, expected)) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
  console.log(`        expected ${JSON.stringify(expected)}`);
  console.log(`        actual   ${JSON.stringify(actual)}`);
}

function truthy(label, value) {
  check(label, Boolean(value), true);
}

/**
 * Retries an assertion that depends on upstream being up. Cinemeta answers 20/20
 * in steady state but 504s in bursts, and a burst must not read as an adapter
 * defect. The payload assertions stay single-shot; only the call-path assertions
 * go through here.
 */
async function eventually(label, run, expected, attempts = 5) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await run();
    if (sameValue(last, expected)) {
      check(`${label} [upstream ok on attempt ${attempt}]`, last, expected);
      return last;
    }
  }
  check(label, last, expected);
  console.log(`        upstream disagreed ${attempts} times running`);
  return last;
}

async function rawMeta(kind, id, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${BASE}/meta/${kind}/${id}.json`, {
        headers: { accept: 'application/json' },
      });
      if (res.ok) {
        const body = await res.json();
        if (body?.meta) return body.meta;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`could not read upstream meta/${kind}/${id}.json after ${attempts} attempts`);
}

/** A null item means upstream was down, so retry before treating it as a defect. */
async function getWithRetry(id, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const item = await cinemeta.get(id);
    if (item) return item;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`cinemeta.get('${id}') returned null ${attempts} times`);
}

function stringsIn(value, path = '', out = []) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => stringsIn(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) stringsIn(v, `${path}.${k}`, out);
  }
  return out;
}

function assertNoHtml(label, value) {
  const all = stringsIn(value);
  check(`${label} carries no HTML in any string field`,
    all.filter(([, s]) => HTML.test(s)).map(([p]) => p), []);
  console.log(`        scanned ${all.length} string fields`);
}

async function main() {
  console.log('maturity derivation');
  check('Animation/Family/Kids -> child', maturityOf({ genres: ['Animation', 'Family'] }), 'child');
  check('Horror/War/Thriller/Crime -> adult', maturityOf({ genres: ['Crime', 'Drama'] }), 'adult');
  check('anything else -> teen', maturityOf({ genres: ['Drama', 'Romance'] }), 'teen');
  check('adult outranks child', maturityOf({ genres: ['Animation', 'Horror'] }), 'adult');
  check('no genres -> teen', maturityOf({ genres: [] }), 'teen');

  console.log('\nget() movie tt0111161 (The Shawshank Redemption)');
  const shawshankRaw = await rawMeta('movie', 'tt0111161');
  check('upstream year literal', shawshankRaw.year, '1994');
  check('upstream runtime literal', shawshankRaw.runtime, '142 min');
  const shawshank = await getWithRetry('tt0111161');
  check('kind', shawshank.kind, 'movie');
  check('title', shawshank.title, 'The Shawshank Redemption');
  check('year parsed from year', shawshank.year, 1994);
  check('durationSeconds parsed from "142 min"', shawshank.durationSeconds, 8520);
  check('genres from genres[]', shawshank.genres, ['Drama']);
  check('maturity derived, not passed through', shawshank.maturity, 'teen');
  check('rating parsed from string "9.3"', shawshank.rating, 9.3);
  check('cast', shawshank.cast, ['Tim Robbins', 'Morgan Freeman', 'Bob Gunton']);
  check('provider', shawshank.provider, 'cinemeta');
  check('poster upgraded to the medium size', shawshank.posterUrl,
    'https://images.metahub.space/poster/medium/tt0111161/img');
  check('backdrop', shawshank.backdropUrl,
    'https://images.metahub.space/background/medium/tt0111161/img');
  truthy('logo present', shawshank.logoUrl);
  check('no episodes key on a movie', 'episodes' in shawshank, false);
  truthy('synopsis is prose', shawshank.synopsis.length > 0);
  console.log(`        synopsis ${JSON.stringify(shawshank.synopsis)}`);
  assertNoHtml('movie item', shawshank);

  console.log('\nget() series tt5753856 (Dark) - year is a range');
  const darkRaw = await rawMeta('series', 'tt5753856');
  check('upstream year literal carries a range', darkRaw.year, `2017${EN_DASH}2020`);
  check('upstream runtime literal is a per-episode average', darkRaw.runtime, '56 min');
  check('upstream video count', darkRaw.videos.length, 26);
  const dark = await getWithRetry('tt5753856');
  check('kind', dark.kind, 'series');
  check('title', dark.title, 'Dark');
  check('year takes the leading 4 digits of the range', dark.year, 2017);
  check('series durationSeconds is null, not the per-episode average',
    dark.durationSeconds, null);
  check('genres', dark.genres, ['Crime', 'Drama', 'Mystery']);
  check('maturity derived from Crime', dark.maturity, 'adult');
  check('rating', dark.rating, 8.7);
  check('seasonCount counts seasons 1..N only', dark.seasonCount, 3);
  check('episode count', dark.episodes.length, 26);
  truthy('logo present', dark.logoUrl);
  console.log(`        logo ${dark.logoUrl}`);
  check('first episode id', dark.episodes[0].id, 'tt5753856:1:1');
  check('first episode seriesId', dark.episodes[0].seriesId, 'tt5753856');
  check('first episode title', dark.episodes[0].title, 'Secrets');
  check('first episode durationSeconds from "56 min"', dark.episodes[0].durationSeconds, 3360);
  check('first episode stillUrl from thumbnail', dark.episodes[0].stillUrl,
    'https://episodes.metahub.space/tt5753856/1/1/w780.jpg');
  truthy('first episode synopsis', dark.episodes[0].synopsis);
  console.log(`        episode synopsis ${JSON.stringify(dark.episodes[0].synopsis)}`);
  assertNoHtml('series item incl. every episode', dark);

  console.log('\nget() series tt0944947 (Game of Thrones) - specials in season 0');
  const gotRaw = await rawMeta('series', 'tt0944947');
  check('upstream year literal carries a range', gotRaw.year, `2011${EN_DASH}2019`);
  check('upstream video count', gotRaw.videos.length, 128);
  check('upstream season 0 holds specials', gotRaw.videos.filter((v) => v.season === 0).length, 55);
  const got = await getWithRetry('tt0944947');
  check('title', got.title, 'Game of Thrones');
  check('year takes the leading 4 digits of the range', got.year, 2011);
  check('series durationSeconds is null', got.durationSeconds, null);
  check('episodes exclude the 55 season-0 specials', got.episodes.length, 73);
  check('seasonCount ignores the season-0 bucket', got.seasonCount, 8);
  check('maturity derived from Action/Adventure/Drama', got.maturity, 'teen');
  check('episode durationSeconds from "57 min"', got.episodes[0].durationSeconds, 3420);
  assertNoHtml('series item incl. every episode', got);

  console.log('\nepisodes()');
  await eventually('season 1 of Dark has 10 episodes',
    () => cinemeta.episodes(dark, { season: 1 }).then((e) => e.length), 10);
  // 10/8/8, and season 2 is the one number the other two do not imply. It is also
  // what a reader would catch if the upstream 20-latest cap ever leaked in here.
  await eventually('season 2 of Dark has 8 episodes',
    () => cinemeta.episodes(dark, { season: 2 }).then((e) => e.length), 8);
  await eventually('no season filter returns every episode',
    () => cinemeta.episodes(dark).then((e) => e.length), 26);
  check('episodes() for a bogus id is empty, not a throw',
    await cinemeta.episodes({ id: 'tt0000000' }), []);

  console.log('\nbrowse()');
  await eventually('limit is honoured', () => cinemeta.browse({ kind: 'movie', limit: 6 }).then((i) => i.length), 6);
  await eventually('kind filter holds',
    () => cinemeta.browse({ kind: 'movie', limit: 6 }).then((i) => i.every((m) => m.kind === 'movie')), true);
  const movies = await cinemeta.browse({ kind: 'movie', limit: 6 });
  await eventually('skip moves the window',
    async () => (await cinemeta.browse({ kind: 'movie', skip: 3, limit: 2 })).map((m) => m.id),
    movies.map((m) => m.id).slice(3, 5));
  await eventually('every Sci-Fi result is tagged Sci-Fi',
    () => cinemeta.browse({ kind: 'series', genre: 'Sci-Fi', limit: 6 })
      .then((i) => i.length > 0 && i.every((s) => s.genres.includes('Sci-Fi'))), true);
  const scifi = await cinemeta.browse({ kind: 'series', genre: 'Sci-Fi', limit: 6 });
  console.log(`        ${scifi.map((s) => s.title).join(', ')}`);
  // Concatenating the kinds would answer this with 40 movies and no series at all,
  // so the presence of both is the assertion, not a snapshot of the counts.
  const mixed = await cinemeta.browse({ limit: 40 });
  await eventually('an unfiltered browse interleaves both kinds',
    () => cinemeta.browse({ limit: 40 })
      .then((i) => i.some((m) => m.kind === 'movie') && i.some((m) => m.kind === 'series')),
    true);
  assertNoHtml('browse batch', mixed.slice(0, 12));

  console.log('\nsearch()');
  await eventually('search finds Dark by title',
    () => cinemeta.search('dark', { kind: 'series' }).then((r) => r.some((h) => h.id === 'tt5753856')),
    true);
  await eventually('every hit matches the query',
    () => cinemeta.search('dark', { kind: 'series' })
      .then((r) => r.length > 0 && r.every((h) => h.title.toLowerCase().includes('dark'))), true);
  const hits = await cinemeta.search('dark', { kind: 'series' });
  console.log(`        ${hits.map((h) => h.title).join(', ')}`);
  await eventually('search honours limit',
    () => cinemeta.search('dark', { limit: 2 }).then((r) => r.length), 2);
  check('blank query does not hit the network', await cinemeta.search('   '), []);

  console.log('\nfailure handling');
  await eventually('get() for an unknown id is null', () => cinemeta.get('tt0000000'), null);
  check('get() for a blank id is null', await cinemeta.get(''), null);
  // Upstream answers an id that exists nowhere in one of two wrong ways, and the
  // shape of the wrong answer is not stable: a `{"meta": null}` for the series
  // path, a 200 stub echoing the id back with every content field null for the
  // movie path, or a 504. Only the adapter's answer is asserted, because that is
  // the part this repo owns.
  await eventually('neither bogus-id answer becomes an item',
    () => cinemeta.get('zz-not-real'), null);

  // BASE is read at import, so a blackhole host has to be proven in a child process.
  const probe = [
    "import { cinemeta } from './server/src/providers/cinemeta.js';",
    'const out = {',
    "  browse: await cinemeta.browse({ kind: 'movie' }),",
    "  get: await cinemeta.get('tt0111161'),",
    "  search: await cinemeta.search('dark'),",
    "  episodes: await cinemeta.episodes({ id: 'tt5753856' }),",
    '};',
    'console.log(JSON.stringify(out));',
  ].join('\n');
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      CINEMETA_BASE: 'http://127.0.0.1:1',
      CINEMETA_TIMEOUT_MS: '1500',
    },
  });
  check('an unreachable host degrades instead of throwing', JSON.parse(stdout), {
    browse: [],
    get: null,
    search: [],
    episodes: [],
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAILED  ${f}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('check script crashed:', err);
  process.exit(1);
});
