/**
 * Provider contract for the CFLIX revamp.
 *
 * Three adapters (Cinemeta, TVMaze, Kitsu) normalize their upstream payloads into the
 * shapes below. Pages consume only these shapes, never a provider's raw field names.
 *
 * Two rules make this the single place a provider difference can live:
 *   1. Every adapter returns the same `CatalogItem` variant regardless of source.
 *   2. Optional upstream data is `null`, never a partial object with missing keys.
 *
 * @typedef {'child'|'teen'|'adult'} Maturity
 *
 * @typedef {Object} CatalogItemBase
 * @property {'movie'|'series'} kind
 * @property {string} id                 Provider-native, stable, URL-safe (e.g. 'tt0111161', 'kitsu:1555').
 * @property {string} title
 * @property {string} synopsis            Plain text. HTML stripped, collapsed whitespace.
 * @property {string|null} posterUrl      Portrait 2:3. Drives card rails and portrait grids.
 * @property {string|null} backdropUrl    Landscape 16:9. Drives hero, continue-watching, episode stills.
 * @property {string|null} logoUrl        Title treatment artwork. Falls back to styled text when null.
 * @property {number|null} year
 * @property {number|null} durationSeconds  Movies and episodes only. Null for a series total.
 * @property {Maturity} maturity          Derived, never taken raw from upstream. See maturity.js.
 * @property {string[]} genres
 * @property {string[]} cast              Actor names, in billing order. May be empty.
 * @property {number|null} rating         0-10 scale, normalized across providers.
 * @property {string|null} trailerYtId     YouTube id. The only legal video source we have.
 * @property {string} provider            'cinemeta' | 'tvmaze' | 'kitsu'. For attribution.
 *
 * @typedef {CatalogItemBase & {
 *   kind: 'movie',
 *   durationSeconds: number,
 * }} MovieItem
 *
 * @typedef {CatalogItemBase & {
 *   kind: 'series',
 *   seasonCount: number,
 *   episodes: Episode[],
 * }} SeriesItem
 *
 * @typedef {Object} Episode
 * @property {string} id
 * @property {string} seriesId
 * @property {number} seasonNumber
 * @property {number} episodeNumber
 * @property {string} title
 * @property {number} durationSeconds
 * @property {string|null} synopsis
 * @property {string|null} stillUrl        Landscape episode still.
 *
 * @typedef {MovieItem|SeriesItem} CatalogItem
 */

/**
 * Cache contract. A1 implements this; every adapter consumes it and must not call `fetch`
 * for provider data directly.
 *
 * @typedef {Object} CacheStore
 * @property {(key: string) => Promise<any|null>} get      Stale value while a refresh runs, else null.
 * @property {(key: string, value: any) => Promise<void>} put
 * @property {(key: string) => Promise<void>} invalidate
 */

/**
 * Adapter contract. One module per provider.
 *
 * @typedef {Object} ProviderAdapter
 * @property {string} name
 * @property {(opts: {kind?: 'movie'|'series', genre?: string, skip?: number, limit?: number}) => Promise<CatalogItem[]>} browse
 * @property {(id: string) => Promise<CatalogItem|null>} get
 * @property {(text: string, opts?: {kind?: 'movie'|'series'|'anime', limit?: number}) => Promise<CatalogItem[]>} search
 * @property {(item: CatalogItem, opts?: {season?: number}) => Promise<Episode[]>} episodes
 * @property {(id: string) => string|null} episodeOwnerId
 *   The series id owning `id`, given one of this adapter's own episode ids, else null. Declared
 *   per adapter rather than in a shared table because an adapter is the only thing that knows the
 *   shape of the ids it mints. `scripts/provider-routing-check.mjs` fails if an adapter listed in
 *   `ADAPTER_ORDER` omits it, so this is enforced rather than merely documented.
 */

/** @type {ProviderAdapter[]} */
export const ADAPTER_ORDER = ['cinemeta', 'tvmaze', 'kitsu'];

/** Provider used when PROVIDER is unset. Cinemeta is the only one covering movies + series. */
export const DEFAULT_PROVIDER = 'cinemeta';

export function activeProvider() {
  const chosen = process.env.PROVIDER;
  return ADAPTER_ORDER.includes(chosen) ? chosen : DEFAULT_PROVIDER;
}

/**
 * Stable cache key. The provider is part of the key so switching PROVIDER cannot serve
 * another provider's shapes from a stale entry.
 */
export function cacheKey(provider, ...parts) {
  return [provider, ...parts].join(':');
}
