/**
 * TVmaze adapter. Series-only: TVmaze publishes no movies and no age certificates.
 *
 * Upstream is free, key-less, CORS-enabled, and cached there for ~60 minutes. It promises
 * "at least 20 calls every 10 seconds" per IP, so every request in this file goes through one
 * serialized sliding-window queue. Data is licensed CC BY-SA and requires TVmaze attribution.
 *
 * @typedef {import('./contract.js').CatalogItem} CatalogItem
 * @typedef {import('./contract.js').Episode} Episode
 */

import { maturityOf } from './maturity.js';

const BASE = 'https://api.tvmaze.com';
const REQUEST_TIMEOUT_MS = 8000;
const WINDOW_MS = 10_000;
/** Upstream promises at least 20 per 10s; 15 leaves headroom for a shared egress IP. */
const WINDOW_MAX = 15;
const RETRY_AFTER_MS = 1500;
const DEFAULT_LIMIT = 12;

/**
 * TVmaze has no popularity or genre index, so browse resolves a fixed set of well-known names.
 * Each seed is one call; replace this list to change what the rails feature.
 */
export const BROWSE_SEEDS = [
  'Dark',
  'Severance',
  'The Bear',
  'Chernobyl',
  'Fleabag',
  'Silo',
  'The OA',
  'Arcane',
  'Bluey',
  'Breaking Bad',
  'True Detective',
  'Mr. Robot',
  'Fargo',
  'Andor',
];

export const name = 'tvmaze';

const NAMED_ENTITIES = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  sect: '§',
  para: '¶',
  dagger: '†',
  laquo: '«',
  raquo: '»',
  times: '×',
  divide: '÷',
  szlig: 'ß',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  ccedil: 'ç',
  ntilde: 'ñ',
  aelig: 'æ',
  oslash: 'ø',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  deg: '°',
};

const codePoint = (n) =>
  n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';

/**
 * Summaries arrive as wiki HTML (`<p>` blocks wrapping `<b>`/`<i>`). Every tag becomes a space
 * so adjacent paragraphs do not fuse into one word, then entities decode and whitespace
 * collapses. The tag pattern requires a letter after `<` so prose like `a < b` survives.
 *
 * @param {unknown} html
 * @returns {string|null}
 */
function plainText(html) {
  if (typeof html !== 'string' || html === '') return null;
  const decoded = html
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(
      /&([a-z][a-z0-9]*);/gi,
      (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
  const flat = decoded.replace(/\s+/g, ' ').trim();
  return flat === '' ? null : flat;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const noop = () => {};

/** @type {number[]} */
let stamps = [];
/** @type {Promise<unknown>} */
let tail = Promise.resolve();

async function claimSlot() {
  for (;;) {
    const now = Date.now();
    stamps = stamps.filter((t) => now - t < WINDOW_MS);
    if (stamps.length < WINDOW_MAX) {
      stamps.push(now);
      return;
    }
    await sleep(WINDOW_MS - (now - stamps[0]) + 25);
  }
}

/** One request at a time, bursted inside the window, so a rail of six never paces itself. */
function serialize(fn) {
  const result = tail.then(async () => {
    await claimSlot();
    return fn();
  });
  tail = result.then(noop, noop);
  return result;
}

/**
 * The single fetch site in this adapter. Swap this one function body for a cache read/write
 * once the shared store lands; every other function here goes through it.
 *
 * @param {string} path Absolute upstream path with query string.
 * @returns {Promise<any>} Parsed JSON, or null on any failure. Never throws at the caller.
 */
function request(path) {
  return serialize(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_AFTER_MS);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${BASE}${path}`, {
          signal: controller.signal,
          redirect: 'follow',
        });
        if (res.status === 429 && attempt === 0) {
          await res.body?.cancel();
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel();
          return null;
        }
        const text = await res.text();
        // Lookup endpoints answer an unresolved id with the literal body "null".
        return text === 'null' ? null : JSON.parse(text);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  });
}

const limitOf = (limit) => {
  const n = Number(limit);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIMIT;
};

const imageUrl = (image) =>
  image && typeof image === 'object'
    ? (image.original ?? image.medium ?? null)
    : null;

const yearOf = (iso) => {
  const year = Number.parseInt(String(iso ?? '').slice(0, 4), 10);
  return Number.isInteger(year) && year > 1800 ? year : null;
};

/**
 * A portrait `image` is never usable as a backdrop, so only the artwork endpoint can fill
 * `backdropUrl`. `typography` is the only logo source; most shows have none and pages fall
 * back to styled text.
 */
function pickArtwork(images) {
  const ofType = (kind) =>
    (Array.isArray(images) ? images.find((i) => i?.type === kind) : null)
      ?.resolutions?.original?.url ?? null;
  return {
    backdropUrl: ofType('background') ?? ofType('banner'),
    logoUrl: ofType('typography'),
  };
}

function pickCast(cast) {
  if (!Array.isArray(cast)) return [];
  return cast
    .map((credit) => credit?.person?.name)
    .filter((person) => typeof person === 'string' && person !== '');
}

/**
 * @param {any} episode
 * @param {number|string} seriesId
 * @param {number} fallbackMinutes Show average, used when an episode runtime is null.
 * @returns {Episode}
 */
function normalizeEpisode(episode, seriesId, fallbackMinutes) {
  const minutes = Number(episode.runtime ?? fallbackMinutes);
  const season = Number(episode.season) || 0;
  const number = Number(episode.number) || 0;
  return {
    id: String(episode.id),
    seriesId: String(seriesId),
    seasonNumber: season,
    episodeNumber: number,
    title: String(episode.name ?? '').trim() || `Episode ${number}`,
    // The contract types this non-null, so a null upstream runtime resolves to the show average.
    durationSeconds: (Number.isFinite(minutes) ? minutes : 0) * 60,
    synopsis: plainText(episode.summary),
    stillUrl: imageUrl(episode.image),
  };
}

function normalizeSeries(
  show,
  { seasonCount = 0, episodes = [], artwork = {}, cast = [] } = {},
) {
  return {
    kind: 'series',
    id: String(show.id),
    title: String(show.name ?? '').trim(),
    synopsis: plainText(show.summary),
    posterUrl: imageUrl(show.image),
    backdropUrl: artwork.backdropUrl ?? null,
    logoUrl: artwork.logoUrl ?? null,
    year: yearOf(show.premiered),
    durationSeconds: null,
    maturity: maturityOf({ genres: show.genres }),
    genres: Array.isArray(show.genres) ? show.genres.map(String) : [],
    cast,
    rating: Number.isFinite(show.rating?.average) ? show.rating.average : null,
    trailerYtId: null,
    provider: name,
    seasonCount,
    episodes,
  };
}

function listing(show, seasonCount) {
  return normalizeSeries(show, { seasonCount });
}

/** Full detail shape: episodes, artwork and cast, all three fetched beside the show. */
async function enrich(show) {
  const showId = show.id;
  const fallbackMinutes = Number(show.averageRuntime ?? show.runtime) || 0;
  const [episodeList, images, cast] = await Promise.all([
    request(`/shows/${showId}/episodes`),
    request(`/shows/${showId}/images`),
    request(`/shows/${showId}/cast`),
  ]);
  const episodes = Array.isArray(episodeList)
    ? episodeList.map((episode) =>
        normalizeEpisode(episode, showId, fallbackMinutes),
      )
    : [];
  return normalizeSeries(show, {
    seasonCount: new Set(episodes.map((e) => e.seasonNumber)).size,
    episodes,
    artwork: pickArtwork(images),
    cast: pickCast(cast),
  });
}

/**
 * @param {{kind?: string, genre?: string, skip?: number, limit?: number}} opts
 * @returns {Promise<CatalogItem[]>}
 */
export async function browse({ kind = 'series', genre, skip = 0, limit } = {}) {
  if (kind === 'movie') return [];
  const wanted = genre ? String(genre).toLowerCase() : null;
  const start = Math.max(0, Number(skip) || 0);
  const cap = limitOf(limit);
  // No upstream offset exists, so skip indexes the seed list. A genre request scans every
  // remaining seed because genre is only knowable after the show resolves.
  const seeds = BROWSE_SEEDS.slice(start, wanted ? undefined : start + cap);
  const shows = await Promise.all(
    seeds.map((seed) =>
      request(
        `/singlesearch/shows?q=${encodeURIComponent(seed)}&embed=seasons`,
      ),
    ),
  );
  const items = shows
    .filter(Boolean)
    .map((show) => listing(show, show._embedded?.seasons?.length ?? 0));
  const matched = wanted
    ? items.filter((item) =>
        item.genres.some((g) => g.toLowerCase() === wanted),
      )
    : items;
  return matched.slice(0, cap);
}

/**
 * @param {string} id TVmaze numeric show id.
 * @returns {Promise<CatalogItem|null>}
 */
export async function get(id) {
  const showId = String(id ?? '').trim();
  if (!/^\d+$/.test(showId)) return null;
  const show = await request(`/shows/${showId}`);
  return show ? enrich(show) : null;
}

/**
 * @param {string} text
 * @param {{kind?: string, limit?: number}} opts
 * @returns {Promise<CatalogItem[]>}
 */
export async function search(text, { kind = 'series', limit } = {}) {
  const query = String(text ?? '').trim();
  if (query === '' || kind === 'movie') return [];
  const cap = limitOf(limit);
  const hits = await request(`/search/shows?q=${encodeURIComponent(query)}`);
  if (!Array.isArray(hits)) return [];
  const top = hits
    .slice(0, cap)
    .map((hit) => hit?.show)
    .filter(Boolean);
  // search/shows ignores embed, so season counts cost one extra call per row. Keep limit at or
  // below 14 to stay inside a single rate-limit window.
  return Promise.all(
    top.map(async (show) => {
      const withSeasons = await request(`/shows/${show.id}?embed=seasons`);
      return listing(show, withSeasons?._embedded?.seasons?.length ?? 0);
    }),
  );
}

/**
 * @param {CatalogItem} item
 * @param {{season?: number}} opts
 * @returns {Promise<Episode[]>}
 */
export async function episodes(item, { season } = {}) {
  const showId = String(item?.id ?? '').trim();
  if (!/^\d+$/.test(showId)) return [];
  // One call returns the show and its episodes, which the show's averageRuntime backfills.
  const show = await request(`/shows/${showId}?embed=episodes`);
  const list = show?._embedded?.episodes;
  if (!Array.isArray(list)) return [];
  const fallbackMinutes = Number(show.averageRuntime ?? show.runtime) || 0;
  const wanted = Number.isInteger(season) ? season : null;
  return list
    .filter((episode) => wanted === null || Number(episode.season) === wanted)
    .map((episode) => normalizeEpisode(episode, showId, fallbackMinutes));
}

/**
 * `normalizeEpisode` mints a bare episode number, which is the same shape as a show id and names
 * no series, so a TVmaze episode ref cannot be split and `/api/play` has to take the series.
 *
 * @param {string} _id Unused: no TVmaze id distinguishes an episode from a show.
 * @returns {null}
 */
export function episodeOwnerId(_id) {
  return null;
}

/**
 * The bridge from a `tt...` id (Cinemeta, or any IMDb-keyed source) to a TVmaze show.
 * `lookup/shows?imdb=` answers with a 301 to `/shows/:id`; `fetch` follows it, so the body
 * arriving here is already the full show and needs no second show fetch. Output is the same
 * shape `get()` returns, so the title page renders either id through one code path.
 *
 * @param {string} imdbId
 * @returns {Promise<CatalogItem|null>}
 */
export async function lookupByImdbId(imdbId) {
  const id = String(imdbId ?? '').trim();
  if (!/^tt\d+$/i.test(id)) return null;
  const show = await request(`/lookup/shows?imdb=${encodeURIComponent(id)}`);
  return show?.id ? enrich(show) : null;
}
