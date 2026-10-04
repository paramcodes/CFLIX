const BASE = 'https://kitsu.io/api/edge';

import { maturityOf } from './maturity.js';

export const name = 'kitsu';

/** Upstream rejects `page[limit]` above 20 with a 400, so every list call is clamped. */
const MAX_PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 20;
/** One Piece has 1410 episodes; a detail page must not pull the whole run. */
const MAX_EPISODES = 200;
/** Bounds the page-walking loop that compensates for client-side genre filtering. */
const MAX_PAGES = 5;

const SUBTYPE_BY_KIND = { movie: 'Movie', series: 'TV' };

const SOURCE_ATTRIBUTION = /\(Source:[^)]*\)/gi;

/**
 * Sort values verified against the live API. `sort=popularity`, `sort=trending` and
 * `sort=rating` are all rejected with `400 Invalid sort criteria`, so the rails are named
 * after what actually works. `popularityRank` ascending is the popularity order: rank 1 is the
 * most popular title, which is why the descending form is the *least* popular.
 */
export const RAILS = Object.freeze({
  popular: 'popularityRank',
  mostRated: '-userCount',
  topRated: '-averageRating',
  favorites: '-favoritesCount',
  newest: '-startDate',
});

const RAIL_VALUES = new Set(Object.values(RAILS));

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * The single seam every call goes through, so A1 can add its cache here without this file
 * knowing about it. Swallows every failure: a provider outage reads as "no data", never as a
 * thrown error at a page.
 */
async function kit(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.api+json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const flat = value
    .replace(SOURCE_ATTRIBUTION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat || null;
}

function pickImage(image, sizes) {
  if (!image || typeof image !== 'object') return null;
  for (const size of sizes) {
    const url = image[size];
    if (typeof url === 'string' && url) return url;
  }
  return null;
}

function yearOf(startDate) {
  if (typeof startDate !== 'string') return null;
  const year = Number.parseInt(startDate.slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

function ratingOf(averageRating) {
  const score = Number.parseFloat(averageRating);
  if (!Number.isFinite(score)) return null;
  return Math.round((score / 10) * 100) / 100;
}

function titleOf(a) {
  const titles = a.titles || {};
  return (
    a.canonicalTitle ||
    titles.en_us ||
    titles.en ||
    titles.en_jp ||
    titles.ja_jp ||
    (a.abbreviatedTitles || [])[0] ||
    'Untitled'
  );
}

/** Genres arrive as a `relationships.genres` id list joined against `included`, not inline. */
function genreNames(record, included) {
  const ids = (record.relationships?.genres?.data || []).map((rel) => rel.id);
  const pool = included || [];
  return ids
    .map((id) => pool.find((entry) => entry.id === id)?.attributes?.name)
    .filter((name) => typeof name === 'string' && name);
}

function toItem(record, included) {
  const a = record.attributes || {};
  const genres = genreNames(record, included);
  return {
    kind: 'series',
    id: `kitsu:${record.id}`,
    title: titleOf(a),
    synopsis: cleanText(a.synopsis) || cleanText(a.description) || '',
    // posterImage carries a `medium`; coverImage does not, only tiny/small/large/original.
    posterUrl: pickImage(a.posterImage, [
      'medium',
      'small',
      'large',
      'original',
    ]),
    backdropUrl: pickImage(a.coverImage, ['large', 'small', 'original']),
    logoUrl: null,
    year: yearOf(a.startDate),
    durationSeconds: null,
    maturity: maturityOf({
      genres,
      ageRating: a.ageRating,
      guide: a.ageRatingGuide,
      nsfw: a.nsfw,
    }),
    genres,
    cast: [],
    rating: ratingOf(a.averageRating),
    trailerYtId:
      typeof a.youtubeVideoId === 'string' && a.youtubeVideoId
        ? a.youtubeVideoId
        : null,
    provider: name,
    seasonCount: 1,
    episodes: [],
  };
}

/**
 * Kitsu models no seasons, so every title is one season of `episodeCount` episodes and
 * `status: current` means that season is still being appended to. Episode ids carry both the
 * anime and the episode so `kitsu:1555:e105967` cannot be confused with an item id.
 */
function toEpisode(record, seriesId, animeId, index) {
  const a = record.attributes || {};
  const titles = a.titles || {};
  const number = Number.isInteger(a.number) ? a.number : index + 1;
  const title =
    a.canonicalTitle ||
    titles.en_us ||
    titles.en_jp ||
    titles.ja_jp ||
    `Episode ${number}`;
  const minutes = Number.parseInt(a.length, 10);
  return {
    id: `kitsu:${animeId}:e${record.id}`,
    seriesId,
    seasonNumber: 1,
    episodeNumber: number,
    title,
    durationSeconds: Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 0,
    synopsis: cleanText(a.synopsis),
    // Only an unsized `original` exists, and it is absent on roughly two thirds of episodes.
    stillUrl:
      typeof a.thumbnail?.original === 'string' ? a.thumbnail.original : null,
  };
}

/**
 * `filter[genres]` silently returns the *entire* catalog for any slug it cannot resolve, and it
 * only resolves single-word slugs, so "Martial Arts" quietly becomes "everything". Filtering the
 * joined genre names instead keeps a wrong genre an empty rail instead of a wrong one.
 */
function matchesGenre(item, genre) {
  if (!genre) return true;
  const wanted = genre.trim().toLowerCase();
  return item.genres.some((name) => name.toLowerCase() === wanted);
}

async function listRecords({
  text,
  kind,
  rail,
  genre,
  skip = 0,
  limit = DEFAULT_LIMIT,
}) {
  const pageSize = clampInt(limit, {
    min: 1,
    max: MAX_PAGE_SIZE,
    fallback: MAX_PAGE_SIZE,
  });
  const start = clampInt(skip, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    fallback: 0,
  });
  const sort = RAIL_VALUES.has(rail) ? rail : RAILS.popular;

  const items = [];
  let offset = start;
  let total = Infinity;

  for (
    let walk = 0;
    walk < MAX_PAGES && items.length < pageSize && offset < total;
    walk++
  ) {
    const body = await kit(
      `/anime${query({
        'filter[text]': text,
        'filter[subtype]': SUBTYPE_BY_KIND[kind],
        include: 'genres',
        sort,
        'page[limit]': MAX_PAGE_SIZE,
        'page[offset]': offset,
      })}`,
    );
    const records = body?.data;
    if (!Array.isArray(records) || records.length === 0) break;
    total = Number.isInteger(body?.meta?.count) ? body.meta.count : total;
    for (const record of records) {
      const item = toItem(record, body.included);
      if (matchesGenre(item, genre)) items.push(item);
    }
    offset += records.length;
  }

  return items.slice(0, pageSize);
}

/**
 * @type {import('./contract.js').ProviderAdapter}
 */
export async function browse({ kind, genre, skip, limit, rail } = {}) {
  return listRecords({ kind, genre, skip, limit, rail });
}

export async function get(id) {
  const numeric = numericId(id);
  if (!numeric) return null;
  const body = await kit(`/anime/${numeric}${query({ include: 'genres' })}`);
  const record = body?.data;
  if (!record || record.type !== 'anime') return null;
  return toItem(record, body.included);
}

export async function search(text, { kind, limit } = {}) {
  const q = typeof text === 'string' ? text.trim() : '';
  // A blank query has no filter to send, so it rides the popularity rail instead of returning
  // nothing, which is what a search box showing suggestions wants.
  return listRecords({ text: q || null, kind, limit });
}

export async function episodes(item, { limit = MAX_EPISODES } = {}) {
  const numeric = numericId(item?.id ?? item);
  if (!numeric) return [];
  const seriesId = `kitsu:${numeric}`;
  const cap = clampInt(limit, {
    min: 1,
    max: MAX_EPISODES,
    fallback: MAX_EPISODES,
  });

  const found = [];
  let offset = 0;
  let total = Infinity;

  while (found.length < cap && offset < total) {
    const body = await kit(
      `/anime/${numeric}/episodes${query({
        'page[limit]': MAX_PAGE_SIZE,
        'page[offset]': offset,
      })}`,
    );
    const records = body?.data;
    if (!Array.isArray(records) || records.length === 0) break;
    total = Number.isInteger(body?.meta?.count) ? body.meta.count : total;
    records.forEach((record, i) =>
      found.push(toEpisode(record, seriesId, numeric, offset + i)),
    );
    if (records.length < MAX_PAGE_SIZE) break;
    offset += records.length;
  }

  return found.slice(0, cap);
}

function numericId(id) {
  if (typeof id === 'number' && Number.isInteger(id) && id > 0)
    return String(id);
  if (typeof id !== 'string') return null;
  const match = /^(?:kitsu:)?(\d+)$/.exec(id.trim());
  return match ? match[1] : null;
}
