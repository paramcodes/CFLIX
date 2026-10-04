import {
  name,
  browse,
  get,
  search,
  episodes,
  lookupByImdbId,
} from '../server/src/providers/tvmaze.js';
import { maturityOf } from '../server/src/providers/maturity.js';

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`        expected ${JSON.stringify(expected)}`);
  console.log(`        actual   ${JSON.stringify(actual)}`);
}

function report(label, value) {
  console.log(`      ${label}: ${JSON.stringify(value)}`);
}

const htmlTags = (item) => {
  const hits = [];
  const walk = (node, at) => {
    if (typeof node === 'string') {
      if (node.includes('<p>') || node.includes('<b>') || node.includes('</')) {
        hits.push(`${at}=${node.slice(0, 120)}`);
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${at}[${i}]`));
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`);
    }
  };
  walk(item, 'item');
  return hits;
};

/**
 * Upstream reference for the aspect assertions. Only the `medium` variant names its variant in
 * the URL path (`medium_portrait`, `medium_landscape`); the `original` variant the adapter
 * prefers is always `original_untouched`, so aspect has to be read from the sibling variant of
 * the same asset. Two requests, outside the rate-limited adapter.
 */
const BASE = 'https://api.tvmaze.com';
const upstreamEpisodes = await (await fetch(`${BASE}/shows/17861/episodes`)).json();
const upstreamImages = await (await fetch(`${BASE}/shows/17861/images`)).json();
const upstreamShow = await (await fetch(`${BASE}/shows/17861`)).json();
const upstreamFaces = await (await fetch(`${BASE}/shows/9558`)).json();

const assetOf = (url) => String(url).split('/').slice(-2).join('/');
const stillVariant = new Map(
  upstreamEpisodes
    .filter((e) => e.image?.medium)
    .map((e) => [assetOf(e.image.original), e.image.medium]),
);
const stillVariantIsLandscape = (url) =>
  (stillVariant.get(assetOf(url)) ?? '').includes('medium_landscape');

console.log('== adapter identity');
check('name', name, 'tvmaze');

console.log('\n== search/shows?q=dark');
const hits = await search('dark', { limit: 4 });
check('result count for limit 4', hits.length, 4);
check('includes show 17861', hits.some((i) => i.id === '17861'), true);
check('top hit title', hits[0].title, 'Dark');
check('top hit provider', hits[0].provider, 'tvmaze');
check('top hit kind', hits[0].kind, 'series');
check('top hit seasonCount', hits[0].seasonCount, 3);
report('top hit id', hits[0].id);
report('top hit maturity', hits[0].maturity);
report('top hit genres', hits[0].genres);
report('every hit id', hits.map((i) => `${i.id} ${i.title}`));
check('search("dark") yields no movies', await search('dark', { kind: 'movie' }), []);
check('search("") yields nothing', await search('   '), []);

console.log('\n== get(17861) — Dark');
const dark = await get('17861');
check('title', dark.title, 'Dark');
check('year', dark.year, 2017);
check('kind', dark.kind, 'series');
check('durationSeconds is null for a series', dark.durationSeconds, null);
check('maturity', dark.maturity, 'teen');
check('rating.average', dark.rating, 8.2);
check('genres', dark.genres, ['Drama', 'Science-Fiction', 'Supernatural']);
check('seasonCount', dark.seasonCount, 3);
check('posterUrl non-empty', typeof dark.posterUrl === 'string' && dark.posterUrl.length > 0, true);
check('posterUrl is upstream image.original', dark.posterUrl, upstreamShow.image.original);
check('that show image is the portrait variant', upstreamShow.image.medium.includes('medium_portrait'), true);
check('backdrop is a different asset from the poster', dark.backdropUrl === dark.posterUrl, false);
report('poster upstream dimensions (images endpoint, separate asset)', (() => {
  const entry = upstreamImages.find((i) => i.type === 'poster');
  return `${entry.resolutions.original.width}x${entry.resolutions.original.height} ${entry.resolutions.original.url}`;
})());
check('cast is populated', dark.cast.length > 0, true);
report('posterUrl', dark.posterUrl);
report('backdropUrl', dark.backdropUrl);
report('logoUrl', dark.logoUrl);
report('synopsis', dark.synopsis);
report('cast[0..2]', dark.cast.slice(0, 3));
console.log('      HTML stripped from every field:', htmlTags(dark).length === 0 ? 'yes' : `NO -> ${htmlTags(dark).join(', ')}`);
check('no <p>, <b> or </ in any field', htmlTags(dark), []);

console.log('\n== entity decoding — show 9558 "New Faces" carries a literal &amp; upstream');
report('raw upstream summary', upstreamFaces.summary);
check('upstream really does contain &amp;', upstreamFaces.summary.includes('&amp;'), true);
const faces = await get('9558');
check('title', faces.title, 'New Faces');
check('synopsis has no raw entity', faces.synopsis.includes('&amp;'), false);
check('synopsis decoded to &', faces.synopsis.includes('&'), true);
check('no HTML left', htmlTags(faces), []);
const around = faces.synopsis.slice(faces.synopsis.indexOf('&') - 45, faces.synopsis.indexOf('&') + 25);
report('decoded context around the &', around);

console.log('\n== shows/17861/episodes');
const eps = await episodes(dark);
check('episode count', eps.length, 26);
check('distinct seasons', [...new Set(eps.map((e) => e.seasonNumber))], [1, 2, 3]);
check('first seasonNumber', eps[0].seasonNumber, 1);
check('first episodeNumber', eps[0].episodeNumber, 1);
check('first title', eps[0].title, 'Geheimnisse');
check('first seriesId', eps[0].seriesId, '17861');
check('first durationSeconds (52 min)', eps[0].durationSeconds, 3120);
check('first stillUrl non-empty', typeof eps[0].stillUrl === 'string' && eps[0].stillUrl.length > 0, true);
check('every stillUrl non-empty', eps.every((e) => typeof e.stillUrl === 'string' && e.stillUrl.length > 0), true);
check('every stillUrl is the landscape variant', eps.every((e) => stillVariantIsLandscape(e.stillUrl)), true);
check('no HTML left in any episode', eps.flatMap((e) => htmlTags(e)), []);
check('season 1 has 10 episodes', eps.filter((e) => e.seasonNumber === 1).length, 10);
check('season 3 has 8 episodes', eps.filter((e) => e.seasonNumber === 3).length, 8);
check('opts.season filters to season 2 only', new Set((await episodes(dark, { season: 2 })).map((e) => e.seasonNumber)), new Set([2]));
report('episode 1 stillUrl', eps[0].stillUrl);
report('episode 1 synopsis', eps[0].synopsis);
report('all 26 durations', [...new Set(eps.map((e) => e.durationSeconds))]);

console.log('\n== lookup/shows?imdb=tt5753856 (the 301 bridge)');
const bridged = await lookupByImdbId('tt5753856');
check('resolves to show id', bridged.id, '17861');
check('same title as get()', bridged.title, dark.title);
check('same year as get()', bridged.year, dark.year);
check('same seasonCount as get()', bridged.seasonCount, dark.seasonCount);
check('carries episodes', bridged.episodes.length, 26);
check('episode 1 title via bridge', bridged.episodes[0].title, 'Geheimnisse');
check('episode 1 stillUrl via bridge', bridged.episodes[0].stillUrl, eps[0].stillUrl);
check('has backdrop art', typeof bridged.backdropUrl === 'string' && bridged.backdropUrl.length > 0, true);
check('cast matches get()', bridged.cast, dark.cast);
report('backdropUrl', bridged.backdropUrl);
report('logoUrl', bridged.logoUrl);
report('externals imdb round-trip', 'tt5753856 -> 17861 Dark');

console.log('\n== bridge rejects bad ids without a network call');
check('unknown imdb id', await lookupByImdbId('tt0000000'), null);
check('non-imdb id', await lookupByImdbId('17861'), null);
check('empty string', await lookupByImdbId(''), null);
check('get() rejects a non-numeric id', await get('dark'), null);
check('get() rejects unknown show', await get('99999999'), null);
check('episodes() on a movie-ish id', await episodes({ id: 'tt0111161' }), []);

console.log('\n== artwork types — /shows/17861/images has poster + background, NO typography');
check('Dark backdropUrl non-empty', typeof dark.backdropUrl === 'string' && dark.backdropUrl.length > 0, true);
check('Dark logoUrl null (no typography art)', dark.logoUrl, null);
const arrow = await get('4');
check('Arrow title', arrow.title, 'Arrow');
check('Arrow logoUrl non-empty', typeof arrow.logoUrl === 'string' && arrow.logoUrl.length > 0, true);
report('Arrow logoUrl', arrow.logoUrl);

console.log('\n== maturityOf (derived, TVmaze ships no certificate)');
check('Crime + Thriller', genresToMaturity(['Crime', 'Thriller']), 'adult');
check('Horror', genresToMaturity(['Horror']), 'adult');
check('Drama + Science-Fiction', genresToMaturity(['Drama', 'Science-Fiction']), 'teen');
check('Comedy + Children', genresToMaturity(['Comedy', 'Children']), 'child');
check('adult beats child', genresToMaturity(['Children', 'Crime']), 'adult');
check('unknown genre falls to teen', genresToMaturity(['Reality']), 'teen');
check('empty input', genresToMaturity([]), 'teen');
check('non-array input', maturityOf({ genres: null }), 'teen');

console.log('\n== browse');
const rail = await browse({ limit: 6 });
check('browse returns 6', rail.length, 6);
check('browse includes Dark', rail.some((i) => i.id === '17861'), true);
check('browse carries no movies', await browse({ kind: 'movie' }), []);
check('every browse item is series', rail.every((i) => i.kind === 'series'), true);
check('every browse item has a poster', rail.every((i) => typeof i.posterUrl === 'string' && i.posterUrl.length > 0), true);
check('browse items carry no episodes (listing shape)', rail.every((i) => i.episodes.length === 0), true);
report('rail titles', rail.map((i) => `${i.title} (${i.year}, ${i.maturity}, ${i.seasonCount}s)`));
const comedy = await browse({ genre: 'Comedy', limit: 20 });
check('genre browse returns only Comedy', comedy.every((i) => i.genres.includes('Comedy')), true);
check('genre browse found comedy shows', comedy.length >= 2, true);
report('comedy rail', comedy.map((i) => i.title));
check('skip pages the seed list', (await browse({ skip: 2, limit: 2 })).map((i) => i.id), rail.slice(2, 4).map((i) => i.id));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);