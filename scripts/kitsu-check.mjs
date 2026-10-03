import {
  name,
  browse,
  get,
  search,
  episodes,
  ageRatingToMaturity,
  RAILS,
} from '../server/src/providers/kitsu.js';
import { MATURITY_RANK } from '../server/src/types.js';

const BASE = 'https://kitsu.io/api/edge';

let failures = 0;
function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail !== undefined) console.log(`        ${detail}`);
  if (!cond) failures++;
}
function show(label, value) {
  console.log(`  ${label.padEnd(30)} ${JSON.stringify(value)}`);
}

async function raw(path) {
  const res = await fetch(BASE + path, {
    headers: { accept: 'application/vnd.api+json' },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log(`provider ${name}\n`);

// ---------------------------------------------------------------- raw upstream record
console.log('== upstream record: /anime?filter[text]=naruto&page[limit]=1 ==');
const live = await raw('/anime?filter[text]=naruto&page[limit]=1');
const liveRecord = live.body.data[0];
const la = liveRecord.attributes;
show('upstream status', live.status);
show('id', liveRecord.id);
show('canonicalTitle', la.canonicalTitle);
show('ageRating', la.ageRating);
show('ageRatingGuide', la.ageRatingGuide);
show('nsfw', la.nsfw);
show('posterImage.medium', la.posterImage.medium);
show('coverImage.large', la.coverImage.large);
show('coverImage.medium', la.coverImage.medium);
show('youtubeVideoId', la.youtubeVideoId);
show('episodeCount', la.episodeCount);
show('episodeLength', la.episodeLength);
show('averageRating', la.averageRating);
show('startDate', la.startDate);

console.log('\n== raw poster/cover keys (coverImage has no `medium`) ==');
show('posterImage keys', Object.keys(la.posterImage).join(','));
show('coverImage keys', Object.keys(la.coverImage).join(','));
check(
  'upstream coverImage.medium is absent',
  la.coverImage.medium === undefined,
);

console.log('\n== adapter: search("naruto") ==');
const hits = await search('naruto', { limit: 3 });
for (const item of hits) {
  show(`${item.id} title`, item.title);
  show('  maturity', item.maturity);
  show('  posterUrl', item.posterUrl);
  show('  backdropUrl', item.backdropUrl);
  show('  trailerYtId', item.trailerYtId);
  show('  genres', item.genres);
  show('  rating/year/kind', [item.rating, item.year, item.kind]);
}
const naruto = hits[0];
check('search returns results', hits.length > 0, `n=${hits.length}`);
check(
  "first hit canonicalTitle === 'Naruto: Shippuuden'",
  naruto.title === 'Naruto: Shippuuden',
  `got ${JSON.stringify(naruto.title)}`,
);
check(
  'id is kitsu:-prefixed',
  naruto.id === 'kitsu:1555',
  `got ${JSON.stringify(naruto.id)}`,
);
check('upstream id matches literal', liveRecord.id === '1555');
check('kind is series', naruto.kind === 'series');
check('seasonCount is 1', naruto.seasonCount === 1);
check("provider is 'kitsu'", naruto.provider === 'kitsu');
check("raw ageRating === 'PG'", la.ageRating === 'PG');
check(
  'PG maps to teen',
  naruto.maturity === 'teen',
  `got ${JSON.stringify(naruto.maturity)}`,
);
check('maturity is a MATURITY_RANK key', naruto.maturity in MATURITY_RANK);
check(
  'posterUrl is non-empty posterImage.medium',
  naruto.posterUrl === la.posterImage.medium && naruto.posterUrl.length > 0,
  `got ${JSON.stringify(naruto.posterUrl)}`,
);
check(
  'backdropUrl is non-empty coverImage.large',
  naruto.backdropUrl === la.coverImage.large && naruto.backdropUrl.length > 0,
  `got ${JSON.stringify(naruto.backdropUrl)}`,
);
check(
  'youtubeVideoId === "1dy2zPPrKD0"',
  la.youtubeVideoId === '1dy2zPPrKD0',
  `got ${JSON.stringify(la.youtubeVideoId)}`,
);
check(
  'trailerYtId matches upstream',
  naruto.trailerYtId === la.youtubeVideoId,
  `got ${JSON.stringify(naruto.trailerYtId)}`,
);
check(
  'rating normalized to 0-10',
  naruto.rating === 8.41,
  `84.06 -> ${naruto.rating}`,
);
check('year from startDate', naruto.year === 2007, `got ${naruto.year}`);
check('logoUrl is null', naruto.logoUrl === null);
check('durationSeconds null for a series', naruto.durationSeconds === null);
check(
  'episodes empty in listings',
  Array.isArray(naruto.episodes) && naruto.episodes.length === 0,
);
check(
  'genres resolved from include',
  naruto.genres.length === 5,
  JSON.stringify(naruto.genres),
);

console.log('\n== synopsis: no (Source: suffix, whitespace collapsed ==');
show('raw tail', la.synopsis.slice(-60));
show('adapter head', naruto.synopsis.slice(0, 80));
show('adapter tail', naruto.synopsis.slice(-40));
check(
  'raw upstream synopsis does contain "(Source:"',
  la.synopsis.includes('(Source:'),
);
check(
  'adapter synopsis has no "(Source:"',
  !naruto.synopsis.includes('(Source:'),
);
check('adapter synopsis has no newline', !naruto.synopsis.includes('\n'));
check('adapter synopsis has no double space', !naruto.synopsis.includes('  '));
check(
  'adapter synopsis is non-empty',
  naruto.synopsis.length > 100,
  `len=${naruto.synopsis.length}`,
);
check(
  'raw had the attribution twice-ish / adapter is shorter',
  naruto.synopsis.length < la.synopsis.length,
  `${la.synopsis.length} -> ${naruto.synopsis.length}`,
);
for (const item of hits) {
  check(`synopsis clean for ${item.id}`, !item.synopsis.includes('(Source:'));
}

console.log('\n== id round trip ==');
const fetched = await get(naruto.id);
show('get(kitsu:1555).id', fetched.id);
show('get(kitsu:1555).title', fetched.title);
check('get() accepts the namespaced id', fetched?.id === 'kitsu:1555');
check('get() returns same title', fetched?.title === 'Naruto: Shippuuden');
check('get() same maturity', fetched?.maturity === 'teen');
const one = await raw('/anime/1555');
show('upstream /anime/1555 status', one.status);
check('get() on a namespaced id resolves', !!fetched);

console.log('\n== get() failure modes never throw ==');
const missing = await get('kitsu:99999999');
show('get(kitsu:99999999)', missing);
check('unknown id returns null', missing === null);
const garbage = await get('not-an-id');
show('get(not-an-id)', garbage);
check('garbage id returns null', garbage === null);
const upstream404 = await raw('/anime/99999999');
show('upstream 404 status', upstream404.status);
show('upstream 404 body', upstream404.body);
const emptySearch = await search('zzzzqqqnotathing', { limit: 5 });
show('search(no-match).length', emptySearch.length);
check('no-match search returns []', emptySearch.length === 0);

console.log('\n== maturity mapping ==');
const cases = [
  ['G', undefined, 'child'],
  ['PG', undefined, 'teen'],
  ['PG-13', undefined, 'teen'],
  ['R', undefined, 'adult'],
  ['R18', undefined, 'adult'],
  [undefined, 'Teens 13 or older', 'teen'],
  [undefined, 'All Ages', 'child'],
  [undefined, 'Mature', 'adult'],
  ['G', undefined, 'child'],
];
for (const [rating, guide, expected] of cases) {
  const got = ageRatingToMaturity(rating, { guide });
  check(
    `${JSON.stringify(rating)} / ${JSON.stringify(guide)} -> ${expected}`,
    got === expected,
    `got ${got}`,
  );
}
check(
  'nsfw:true overrides to adult',
  ageRatingToMaturity('G', { nsfw: true }) === 'adult',
  `got ${ageRatingToMaturity('G', { nsfw: true })}`,
);
check(
  'unmapped rating falls back to teen',
  ageRatingToMaturity('XX', {}) === 'teen',
  `got ${ageRatingToMaturity('XX', {})}`,
);
check('null rating falls back to teen', ageRatingToMaturity(null) === 'teen');
console.log(
  '  real Kitsu rating census (Naruto/One Piece/Attack on Titan/Demon Slayer):',
);
for (const q of [
  'one piece',
  'attack on titan',
  'demon slayer',
  'shaka no shougai',
]) {
  const r = await raw(
    `/anime?filter[text]=${encodeURIComponent(q)}&page[limit]=1`,
  );
  const at = r.body.data[0].attributes;
  show(
    `  ${at.canonicalTitle}`,
    `${at.ageRating} | ${at.ageRatingGuide} -> ${ageRatingToMaturity(at.ageRating, { guide: at.ageRatingGuide, nsfw: at.nsfw })}`,
  );
}

console.log(
  '\n== null images: real record with posterImage:null and coverImage:null ==',
);
const nullImg = await raw('/anime/12412');
const nat = nullImg.body.data.attributes;
show('upstream status', nullImg.status);
show('id / title', `${nullImg.body.data.id} / ${nat.canonicalTitle}`);
show('posterImage', nat.posterImage);
show('coverImage', nat.coverImage);
check('upstream really has null posterImage', nat.posterImage === null);
check('upstream really has null coverImage', nat.coverImage === null);
const nullItem = await get('kitsu:12412');
show('adapter posterUrl', nullItem.posterUrl);
show('adapter backdropUrl', nullItem.backdropUrl);
check(
  'null posterImage -> posterUrl null, no throw',
  nullItem.posterUrl === null,
);
check(
  'null coverImage -> backdropUrl null, no throw',
  nullItem.backdropUrl === null,
);
check(
  'null-image record still returns an item',
  nullItem.title === 'Shaka no Shougai',
);
check('null-image record still gets a maturity', nullItem.maturity === 'child');

const noPoster = await raw('/anime?page[limit]=20&page[offset]=5000');
const partial = noPoster.body.data.filter(
  (d) => !d.attributes.coverImage,
).length;
show(
  'page[offset]=5000 records with null coverImage',
  `${partial}/${noPoster.body.data.length}`,
);
const sweep = [];
for (const off of [800, 5000, 15000]) {
  const r = await raw(`/anime?page[limit]=20&page[offset]=${off}`);
  sweep.push(...r.body.data.map((d) => toShape(d)));
}
check('60 more records map without throwing', sweep.length === 60);
check(
  'every mapped record has a string synopsis and a known maturity',
  sweep.every(
    (s) => typeof s.synopsis === 'string' && s.maturity in MATURITY_RANK,
  ),
);
check(
  'no mapped synopsis leaked "(Source:"',
  sweep.every((s) => !s.synopsis.includes('(Source:')),
);
check(
  'every backdropUrl is null or a media.kitsu.app URL',
  sweep.every(
    (s) => s.backdrop === null || s.backdrop.includes('media.kitsu.app'),
  ),
);

function toShape(d) {
  const at = d.attributes;
  return {
    synopsis: String(at.synopsis || '')
      .replace(/\(Source:[^)]*\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    maturity: ageRatingToMaturity(at.ageRating, {
      guide: at.ageRatingGuide,
      nsfw: at.nsfw,
    }),
    backdrop: at.coverImage?.large ?? null,
  };
}

console.log('\n== episodes ==');
const eps = await episodes({ id: 'kitsu:1555' }, { limit: 5 });
show('count', eps.length);
for (const e of eps) {
  show('  id', e.id);
  show('    seriesId/season/episode', [
    e.seriesId,
    e.seasonNumber,
    e.episodeNumber,
  ]);
  show('    title', e.title);
  show('    durationSeconds', e.durationSeconds);
  show('    stillUrl', e.stillUrl);
  show('    synopsis', e.synopsis ? e.synopsis.slice(0, 60) : null);
}
const rawEps = await raw('/anime/1555/episodes?page[limit]=5');
show('upstream episode count', rawEps.body.meta.count);
check('episodes() returns a list', eps.length === 5, `n=${eps.length}`);
check(
  'episode id is kitsu:-prefixed',
  eps.every((e) => e.id.startsWith('kitsu:1555:e')),
);
check(
  'seriesId is the namespaced item id',
  eps.every((e) => e.seriesId === 'kitsu:1555'),
);
check(
  'seasonNumber is 1 (Kitsu has no seasons)',
  eps.every((e) => e.seasonNumber === 1),
);
check(
  'episodeNumber is sequential from 1',
  eps.map((e) => e.episodeNumber).join(',') === '1,2,3,4,5',
);
check(
  'durationSeconds = episodeLength * 60',
  eps[0].durationSeconds === 1380,
  `${eps[0].durationSeconds} from length=${la.episodeLength}`,
);
check(
  'titles come from upstream',
  eps[0].title === 'Homecoming',
  `got ${JSON.stringify(eps[0].title)}`,
);
check(
  'stillUrl comes from thumbnail.original',
  eps[0].stillUrl ===
    'https://media.kitsu.app/episodes/thumbnails/105967/original.jpeg',
  `got ${JSON.stringify(eps[0].stillUrl)}`,
);
check(
  'episode synopsis carries no "(Source:"',
  eps.every((e) => e.synopsis === null || !e.synopsis.includes('(Source:')),
);
check(
  'some episodes do have a still',
  eps.some((e) => e.stillUrl !== null),
);
check(
  'browse() never populates episodes',
  (await browse({ limit: 2 })).every((i) => i.episodes.length === 0),
);
check(
  'episodes() on a bad id returns []',
  (await episodes({ id: 'nope' })).length === 0,
);
check(
  'episodes() accepts the item object',
  (await episodes(await get('kitsu:1555'), { limit: 1 })).length === 1,
);

console.log('\n== episodes() paging clamps to MAX_EPISODES ==');
const many = await episodes({ id: 'kitsu:12' }, { limit: 45 });
show('One Piece (1410 eps upstream) requested 45', many.length);
check('episodes() pages past the 20-per-request cap', many.length === 45);
const cappedEps = await episodes({ id: 'kitsu:1555' }, { limit: 5000 });
show('requested 5000, capped', cappedEps.length);

console.log('\n== SORT PARAM PROBE (live, reported verbatim) ==');
for (const candidate of [
  'popularity',
  '-popularity',
  'trending',
  'rating',
  '-rating',
  'title',
  '-relevance',
]) {
  const r = await raw(
    `/anime?page[limit]=2&sort=${encodeURIComponent(candidate)}`,
  );
  const verdict = r.status === 200 ? 'WORKS' : 'REJECTED';
  console.log(
    `  sort=${candidate.padEnd(12)} HTTP ${r.status}  ${verdict.padEnd(9)} ${
      r.status === 200
        ? r.body.data.map((d) => d.attributes.canonicalTitle).join(' | ')
        : r.body.errors[0].detail
    }`,
  );
}
console.log('  --- the rails the adapter actually uses ---');
for (const [rail, value] of Object.entries(RAILS)) {
  const r = await raw(`/anime?page[limit]=5&sort=${encodeURIComponent(value)}`);
  const ranks = r.body.data.map((d) => d.attributes.popularityRank);
  console.log(
    `  ${rail.padEnd(11)} sort=${value.padEnd(16)} HTTP ${r.status}  top5=${r.body.data.map((d) => d.attributes.canonicalTitle).join(', ')}`,
  );
  console.log(`  ${''.padEnd(11)} popularityRank=${JSON.stringify(ranks)}`);
}
const badRail = await raw('/anime?page[limit]=2&sort=popularity');
check(
  'briefed sort=popularity is rejected upstream',
  badRail.status === 400,
  `HTTP ${badRail.status}`,
);
check(
  'RAILS.popular is the popularity order',
  RAILS.popular === 'popularityRank',
);

console.log('\n== PAGE PARAM PROBE (live, reported verbatim) ==');
for (const limit of [1, 3, 20, 21, 50]) {
  const r = await raw(`/anime?page[limit]=${limit}`);
  console.log(
    `  page[limit]=${String(limit).padEnd(4)} HTTP ${r.status} returned=${r.body.data ? r.body.data.length : 0} ${r.body.errors ? JSON.stringify(r.body.errors[0].detail) : ''}`,
  );
}
console.log('  --- page[offset] ---');
const offsetSeen = [];
for (const off of [0, 3, 10]) {
  const r = await raw(
    `/anime?page[limit]=3&page[offset]=${off}&sort=popularityRank`,
  );
  const titles = r.body.data.map(
    (d) => `${d.id}:${d.attributes.canonicalTitle}`,
  );
  offsetSeen.push(...titles);
  console.log(
    `  page[offset]=${String(off).padEnd(4)} HTTP ${r.status} ${titles.join(' | ')}`,
  );
  if (r.body.links)
    console.log(`      links.prev=${r.body.links.prev ?? '(none)'}`);
}
check(
  'page[offset] returns a different window each time',
  new Set(offsetSeen).size === 9,
);
const pastOffset = await raw('/anime?page[limit]=3&page[offset]=99999');
console.log(
  `  page[offset]=99999 HTTP ${pastOffset.status} returned=${pastOffset.body.data.length}`,
);
check(
  'offset past the end is an empty 200, not an error',
  pastOffset.status === 200 && pastOffset.body.data.length === 0,
);
check(
  'page[limit] above 20 is a hard 400',
  (await raw('/anime?page[limit]=50')).status === 400,
);

console.log('\n== browse() ==');
const rail = await browse({ limit: 5 });
show('browse().length', rail.length);
for (const i of rail) show(`  ${i.id} ${i.maturity}`, i.title);
check('browse returns a list', rail.length === 5);
check(
  'all browse ids namespaced',
  rail.every((i) => /^kitsu:\d+$/.test(i.id)),
);
check(
  'all browse kinds are series',
  rail.every((i) => i.kind === 'series'),
);
check(
  'all browse maturities known',
  rail.every((i) => i.maturity in MATURITY_RANK),
);
check(
  'browse titles non-empty',
  rail.every((i) => i.title && i.title !== 'Untitled'),
);
check(
  'browse returns the popularity rail',
  rail[0]?.id === 'kitsu:7442',
  `first=${rail[0]?.id} ${rail[0]?.title}`,
);

const skipped = await browse({ skip: 3, limit: 3 });
show(
  'browse({skip:3}).ids',
  skipped.map((i) => i.id),
);
check(
  'skip pages forward',
  skipped.every((i) => !rail.slice(0, 3).some((r) => r.id === i.id)),
);

const asMovie = await browse({ kind: 'movie', limit: 3 });
show(
  'browse({kind: movie}) ids',
  asMovie.map((i) => `${i.id}:${i.title}`),
);
check(
  'kind:movie maps to subtype=Movie',
  asMovie[0]?.id === 'kitsu:11614',
  `got ${asMovie[0]?.title}`,
);
const asSeries = await browse({ kind: 'series', limit: 3 });
show(
  'browse({kind: series}) ids',
  asSeries.map((i) => `${i.id}:${i.title}`),
);
check(
  'kind:series maps to subtype=TV',
  asSeries[0]?.id === 'kitsu:7442',
  `got ${asSeries[0]?.title}`,
);

console.log(
  '\n== filter[genres] is unreliable upstream, so genre filtering is client-side ==',
);
for (const g of ['action', 'martial_arts', 'Martial Arts', 'not_a_genre']) {
  const r = await raw(
    `/anime?page[limit]=1&filter[genres]=${encodeURIComponent(g)}&sort=popularityRank`,
  );
  console.log(
    `  filter[genres]=${g.padEnd(14)} HTTP ${r.status} meta.count=${r.body.meta.count}`,
  );
}
const genreOk = await browse({ genre: 'Action', limit: 5 });
show(
  'browse({genre: Action})',
  genreOk.map((i) => `${i.id}:${i.title}`),
);
check('genre filter returns items', genreOk.length === 5);
check(
  'every item really has Action',
  genreOk.every((i) => i.genres.includes('Action')),
);
const genreNone = await browse({ genre: 'Cooking', limit: 5 });
show(
  'browse({genre: Cooking}) on the popularity rail',
  genreNone.map((i) => i.title),
);
check(
  'an off-rail genre yields a short or empty rail, not wrong items',
  genreNone.every((i) => i.genres.includes('Cooking')),
);

console.log('\n== limit clamping to the upstream page size ==');
const tooMany = await browse({ limit: 100 });
show('browse({limit:100}).length', tooMany.length);
check(
  'limit clamps to 20, never 400s',
  tooMany.length <= 20 && tooMany.length > 0,
);

console.log('\n== rail selection ==');
const topRated = await browse({ rail: RAILS.topRated, limit: 3 });
show(
  'browse({rail: topRated})',
  topRated.map((i) => i.title),
);
const newest = await browse({ rail: RAILS.newest, limit: 3 });
show(
  'browse({rail: newest})',
  newest.map((i) => `${i.title} (${i.year})`),
);
check('topRated rail differs from popular', topRated[0]?.id !== rail[0]?.id);
check(
  'newest rail returns post-2015 titles',
  newest.every((i) => i.year > 2015),
  newest.map((i) => i.year).join(','),
);
const bogusRail = await browse({ rail: 'popularity', limit: 3 });
show(
  'browse({rail: "popularity"}) (the briefed value)',
  bogusRail.map((i) => i.id),
);
check(
  'an invalid rail falls back to popular instead of 400',
  bogusRail.length === 3 && bogusRail[0]?.id === rail[0]?.id,
);

console.log(`\n${failures ? `${failures} FAIL` : '0 FAIL'}`);
process.exit(failures ? 1 : 0);
