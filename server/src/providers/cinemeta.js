/**
 * Cinemeta provider adapter. Normalizes Stremio's Cinemeta into the shapes in
 * contract.js. Free, no API key, the only provider covering movies and series.
 *
 * Upstream facts this file is built against, all observed live:
 *   - Extras are PATH segments (`catalog/movie/top/genre=Action.json`), not query
 *     params. A query string is dropped by the CDN redirect and silently ignored.
 *   - `skip` is ignored on every catalog path.
 *   - `meta/{kind}/{id}` answers a kind mismatch with HTTP 200 and a completely
 *     different title, so the response `type` proves nothing.
 *   - Catalog list items carry at most the 20 latest episodes of a series, which
 *     are its LAST seasons. Only `meta` carries the full list.
 *   - `year` can be null while `releaseInfo` holds the value.
 *   - `imdbRating` is a string, and `""` for unrated titles.
 */

import { maturityOf } from './maturity.js';

const BASE = process.env.CINEMETA_BASE || 'https://v3-cinemeta.strem.io';
const TIMEOUT_MS = Number(process.env.CINEMETA_TIMEOUT_MS || 8000);
const NAME = 'cinemeta';

const TAG = /<[^>]*>/g;
const WHITESPACE = /\s+/g;
const ENTITY = /&(amp|lt|gt|quot|#39|nbsp);/g;
const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

function plainText(value) {
  if (typeof value !== 'string') return '';
  return (
    value
      // Entities decode after tags are stripped, so an escaped "&lt;p&gt;" in the
      // source cannot be turned back into a tag after the fact.
      .replace(TAG, ' ')
      .replace(ENTITY, (m) => ENTITIES[m] || m)
      .replace(WHITESPACE, ' ')
      .trim()
  );
}

function firstText(...values) {
  for (const value of values) {
    const s = plainText(value);
    if (s) return s;
  }
  return '';
}

function parseYear(...values) {
  const match = /(\d{4})/.exec(firstText(...values));
  return match ? Number(match[1]) : null;
}

function parseSeconds(value) {
  if (typeof value !== 'string') return null;
  const hours = /(\d+)\s*h/.exec(value);
  const minutes = /(\d+)\s*min/.exec(value);
  if (!hours && !minutes) return null;
  return Number(hours?.[1] || 0) * 3600 + Number(minutes?.[1] || 0) * 60;
}

/** A string like "9.3", or `""` for unrated. Observed as a string in all 296 titles sampled. */
function parseRating(value) {
  if (typeof value !== 'string') return null;
  const match = /(\d+(?:\.\d+)?)/.exec(value);
  return match ? Number(match[1]) : null;
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === 'string' && v)
    : [];
}

function objectList(value) {
  return Array.isArray(value)
    ? value.filter((v) => v && typeof v === 'object')
    : [];
}

function posterUrl(value) {
  if (typeof value !== 'string') return null;
  // Upstream only ever hands back the thumbnail size, too small for a card rail.
  // medium is the largest jpeg it serves.
  return value.replace('/poster/small/', '/poster/medium/');
}

/**
 * `trailerStreams[].ytId` is the contract's only legal video source, so it wins.
 * `trailers[].source` is the same id under a different key and is the fallback.
 */
function trailerYtId(raw) {
  const fromStreams = objectList(raw.trailerStreams).find(
    (s) => typeof s.ytId === 'string' && s.ytId,
  );
  if (fromStreams) return fromStreams.ytId;
  const fromTrailers = objectList(raw.trailers).find(
    (t) => typeof t.source === 'string' && t.source,
  );
  return fromTrailers ? fromTrailers.source : null;
}

/**
 * Season 0 is dropped: upstream files behind-the-scenes and previews there
 * ("Making Game of Thrones"), 55 of Game of Thrones' 128 videos and 79 of The
 * Walking Dead's 256. They are not episodes and would dominate an episode picker.
 *
 * @param {unknown} videos
 * @param {string} seriesId
 * @param {number|null} episodeSeconds Series-level per-episode average, the only
 *   runtime Cinemeta publishes. It is not a per-episode measurement.
 */
function toEpisodes(videos, seriesId, episodeSeconds) {
  return objectList(videos)
    .filter((v) => Number(v.season) > 0)
    .map((v) => ({
      id: String(v.id || `${seriesId}:${v.season}:${v.number}`),
      seriesId,
      seasonNumber: Number(v.season),
      episodeNumber: Number(v.number),
      title: plainText(v.name) || `Episode ${v.number}`,
      durationSeconds: episodeSeconds,
      synopsis: firstText(v.overview, v.description) || null,
      stillUrl: typeof v.thumbnail === 'string' ? v.thumbnail : null,
    }))
    .sort(
      (a, b) =>
        a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
    );
}

/** Episodes live on the meta payload only, never on a catalog list item. */
function episodesOf(raw, seriesId) {
  return toEpisodes(raw.videos, seriesId, parseSeconds(raw.runtime));
}

function toItem(raw, kind, episodes) {
  const genres = stringList(raw.genres?.length ? raw.genres : raw.genre);
  return {
    kind,
    id: String(raw.id || raw.imdb_id || ''),
    title: plainText(raw.name),
    synopsis: plainText(raw.description),
    posterUrl: posterUrl(raw.poster),
    backdropUrl: typeof raw.background === 'string' ? raw.background : null,
    logoUrl: typeof raw.logo === 'string' ? raw.logo : null,
    year: parseYear(raw.year, raw.releaseInfo),
    // A series total is not a meaningful number, and Cinemeta's series runtime is
    // a per-episode average. It belongs on each Episode, never here.
    durationSeconds: kind === 'series' ? null : parseSeconds(raw.runtime),
    maturity: maturityOf({ genres }),
    genres,
    cast: stringList(raw.cast),
    rating: parseRating(raw.imdbRating),
    trailerYtId: trailerYtId(raw),
    provider: NAME,
    ...(kind === 'series'
      ? {
          seasonCount: new Set(episodes.map((e) => e.seasonNumber)).size,
          episodes,
        }
      : {}),
  };
}

/**
 * @param {string} path
 * @param {(reason: string) => void} [onUpstreamFailure] Called once when the upstream turned out
 *   to be unreachable rather than merely unhelpful. A transport error, an abort, a 5xx or a 429
 *   that survived the retry budget are outages; a 4xx and a 2xx with an empty body are the
 *   upstream answering that it has nothing, which is a miss and not a failure. This is the only
 *   place the two are still distinguishable, so it is the only place that has to decide.
 * @returns {Promise<object|null>} Null unless a 200 with a JSON body arrives
 *   inside the retry budget. Never throws: upstream 504s under load, so an
 *   adapter that throws turns a slow CDN into a 500.
 *
 *   A1's cache seam: replace this body with a CacheStore lookup keyed
 *   `cacheKey('cinemeta', path)` and a fetch on miss. Nothing else changes.
 */
async function getJson(path, onUpstreamFailure) {
  // Reported at most once per call, so a 5xx that survives both attempts is one outage and not
  // two: `consecutiveFailures` has to count calls, not attempts.
  let reported = false;
  const fail = (reason) => {
    if (reported) return;
    reported = true;
    onUpstreamFailure?.(reason);
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/${path}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (res.ok) {
        const body = await res.json();
        return body && typeof body === 'object' ? body : null;
      }
      // 5xx and 429 are worth one more ask; 4xx is an answer, not a hiccup.
      if (res.status < 500 && res.status !== 429) return null;
      fail(`HTTP ${res.status}`);
    } catch (err) {
      // No second ask here, matching the retry budget this file already had, so the report
      // cannot wait for an attempt that never happens.
      fail(err?.name || 'transport error');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function catalogMetas(kind, extra, onUpstreamFailure) {
  const path = extra
    ? `catalog/${kind}/top/${extra}.json`
    : `catalog/${kind}/top.json`;
  const body = await getJson(path, onUpstreamFailure);
  return Array.isArray(body?.metas) ? body.metas : [];
}

/**
 * A real title, or null. Upstream answers two wrong ways and both must collapse
 * to null: a kind mismatch gives `{"meta": null}`, and an id that exists nowhere
 * gives a 200 stub carrying the id back with every content field null.
 */
async function meta(kind, id, onUpstreamFailure) {
  const body = await getJson(
    `meta/${kind}/${encodeURIComponent(id)}.json`,
    onUpstreamFailure,
  );
  const raw = body?.meta;
  if (!raw || typeof raw !== 'object') return null;
  return plainText(raw.name) ? raw : null;
}

function fromCatalog(raw) {
  const kind = raw?.type === 'series' ? 'series' : 'movie';
  return toItem(raw, kind, []);
}

/** Series carry no episodes here: the list caps `videos[]` at the 20 latest, which
 *  are the last seasons, so a picker built from it starts at season 6 of 8.
 *  `get()` and `episodes()` are the full source. */

function catalogItems(raws) {
  return raws
    .map((raw) => (raw && typeof raw === 'object' ? fromCatalog(raw) : null))
    .filter((item) => item && item.id && item.title);
}

function kindsFor(kind) {
  return kind === 'movie' || kind === 'series' ? [kind] : ['movie', 'series'];
}

/**
 * Round-robins across kinds so an unfiltered browse stays a mixed rail. Plain
 * concatenation would answer `browse({ limit: 40 })` with 40 movies and no series,
 * because the movie catalog is returned first and is longer than the limit.
 */
function interleave(groups) {
  const out = [];
  for (let i = 0; i < Math.max(0, ...groups.map((g) => g.length)); i++) {
    for (const group of groups) if (i < group.length) out.push(group[i]);
  }
  return out;
}

function window(items, skip, limit) {
  const from = Math.max(0, Number(skip) || 0);
  const size =
    limit === undefined || limit === null
      ? Infinity
      : Math.max(0, Number(limit) || 0);
  return items.slice(from, from + size);
}

async function browse({
  kind,
  genre,
  skip = 0,
  limit,
  onUpstreamFailure,
} = {}) {
  const extra = genre ? `genre=${encodeURIComponent(genre)}` : '';
  const groups = await Promise.all(
    kindsFor(kind).map((k) =>
      catalogMetas(k, extra, onUpstreamFailure).then(catalogItems),
    ),
  );
  return window(interleave(groups), skip, limit);
}

async function get(id, { onUpstreamFailure } = {}) {
  const wanted = plainText(id);
  if (!wanted) return null;

  // Upstream has no type-agnostic meta endpoint and answers a kind mismatch with
  // 200 plus a different title, so the series endpoint is probed first and its
  // answer is trusted only when it actually carries episodes. `meta/series/{movieId}`
  // is the one honest signal: it returns `{"meta": null}`.
  const asSeries = await meta('series', wanted, onUpstreamFailure);
  if (asSeries) {
    const full = episodesOf(asSeries, wanted);
    if (full.length) return toItem(asSeries, 'series', full);
  }

  // A series with no released episode falls through here and is served the same
  // wrong movie a kind mismatch produces. Cinemeta gives no way to tell it apart.
  const asMovie = await meta('movie', wanted, onUpstreamFailure);
  return asMovie ? toItem(asMovie, 'movie', []) : null;
}

async function search(query, { kind, limit, onUpstreamFailure } = {}) {
  const q = plainText(query);
  if (!q) return [];
  const groups = await Promise.all(
    kindsFor(kind).map((k) =>
      catalogMetas(
        k,
        `search=${encodeURIComponent(q)}`,
        onUpstreamFailure,
      ).then(catalogItems),
    ),
  );
  return window(interleave(groups), 0, limit);
}

async function episodes(item, { season, onUpstreamFailure } = {}) {
  const seriesId = item && typeof item === 'object' ? plainText(item.id) : '';
  if (!seriesId) return [];
  // Always re-reads meta rather than trusting item.episodes, which is empty from
  // browse and truncated to the latest 20 anywhere upstream.
  const raw = await meta('series', seriesId, onUpstreamFailure);
  if (!raw) return [];
  const all = episodesOf(raw, seriesId);
  const wanted =
    season === undefined || season === null ? null : Number(season);
  return wanted === null ? all : all.filter((e) => e.seasonNumber === wanted);
}

/** `toEpisodes` mints `<seriesId>:<season>:<number>`, so that is the shape split back apart here. */
const EPISODE_REF = /^(?<owner>.+):\d+:\d+$/;

/**
 * @param {string} id
 * @returns {string|null} The series owning `id`, or null when it is not a Cinemeta episode id.
 */
export function episodeOwnerId(id) {
  return EPISODE_REF.exec(plainText(id))?.groups?.owner ?? null;
}

/** @type {import('./contract.js').ProviderAdapter} */
export const cinemeta = {
  name: NAME,
  browse,
  get,
  search,
  episodes,
  episodeOwnerId,
};

export default cinemeta;
