import { db, progressOf } from './store.js';
import { movies, series } from './catalog-data.js';
import { maturityAllowed } from './types.js';
import { DomainError } from './errors.js';
import { activeProvider, cacheKey } from './providers/contract.js';
import { cache } from './providers/cache.js';
import { cinemeta } from './providers/cinemeta.js';
import * as tvmaze from './providers/tvmaze.js';
import * as kitsu from './providers/kitsu.js';
import { getCircuitBreaker } from './resilience/circuit-breaker.js';
/**
 * Each adapter module exports `name`, `browse`, `get`, `search` and `episodes` by name, so a
 * module namespace already satisfies the ProviderAdapter shape and needs no wrapper.
 */
const ADAPTERS = { cinemeta, tvmaze, kitsu };

/** `kind=anime` has no seed, Cinemeta or TVmaze equivalent. Kitsu is the only source. */
const KIND_PROVIDER = { anime: 'kitsu' };

/**
 * Ids carry their provider, so a `kitsu:` id resolves through Kitsu even while Cinemeta is the
 * active provider. Cinemeta ids are bare IMDb keys and TVmaze ids are bare numbers, neither of
 * which is namespaced, so those fall through to the active provider.
 */
const ID_PROVIDER = { 'kitsu:': 'kitsu' };

const BROWSE_LIMIT = 24;
const RELATED_LIMIT = 12;

/**
 * The one place an episode ref is split into its owning series id. Each adapter declares the shape
 * of the ids it mints, so this asks them rather than holding an alternation that has to learn each
 * new provider format by hand. PR #39 shipped a bug that way: its regex carried only the `:e123`
 * form Kitsu emits, so a Cinemeta episode id was never reduced to its series, the lookup resolved
 * the raw episode, and the maturity gate blocked every profile with `MATURITY_BLOCKED`. PR #40
 * restored that shape by adding one alternative by hand, and this keeps each shape beside the code
 * that mints it so the next provider needs no hand edit here. Seed refs are matched by identity in
 * `findSeed` before this is reached, and a seed episode id copies Cinemeta's shape, so even a stale
 * one splits back to `seed:s1` rather than to a provider.
 *
 * Precedence is `ADAPTERS` insertion order. A shape has to be specific enough not to claim another
 * adapter's ids, because the first adapter to answer ends the walk.
 */
function episodeOwnerId(id) {
  const wanted = String(id ?? '');
  for (const adapter of Object.values(ADAPTERS)) {
    const owner = adapter.episodeOwnerId(wanted);
    if (owner) return owner;
  }
  return null;
}

/** `PROVIDER=off` forces the seed catalog. It is not in ADAPTER_ORDER, so no real name collides. */
const providerName = () =>
  process.env.PROVIDER === 'off' ? null : activeProvider();

const adapterFor = (name) => ADAPTERS[name] ?? null;

/**
 * The one place a kind becomes a provider, so a second list path cannot route around the table.
 * `PROVIDER=off` outranks the kind table for the same reason it outranks an id namespace, so it
 * forces the fixture even for a kind whose only source is an adapter.
 */
const providerForKind = (kind) =>
  process.env.PROVIDER === 'off'
    ? null
    : (KIND_PROVIDER[kind] ?? providerName());

/** `PROVIDER=off` wins over an id namespace, so the fixture can be forced with either. */
const providerForId = (id) => {
  const prefix = Object.keys(ID_PROVIDER).find((p) =>
    String(id ?? '')
      .toLowerCase()
      .startsWith(p),
  );
  if (prefix)
    return process.env.PROVIDER === 'off' ? null : ID_PROVIDER[prefix];
  return providerName();
};

const notFound = (message) => new DomainError('NOT_FOUND', message);

const lower = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const itemGenres = (item) =>
  (Array.isArray(item.genres) ? item.genres : []).map(lower);

const sourced = (source) => (item) => ({ ...item, source });

const withSource = (items, source) => items.map(sourced(source));

/**
 * The domain invariant, in one place. A child profile must never receive an adult title, so every
 * item a caller can observe passes through here before it leaves the service.
 */
const visibleTo = (profile, items) =>
  items.filter((item) => maturityAllowed(profile.maturity, item.maturity));

function requireProfile(profileId) {
  const p = db.profiles.get(profileId);
  if (!p) throw notFound('no such profile');
  return p;
}

function assertCanWatch(profile, item) {
  if (!maturityAllowed(profile.maturity, item.maturity)) {
    throw new DomainError('MATURITY_BLOCKED', 'not available for this profile');
  }
}

const savedSeconds = (profileId, itemId) => {
  const p = progressOf(profileId).find((x) => x.itemId === String(itemId));
  return p ? p.seconds : 0;
};

const watchedIds = (profileId) =>
  new Set(progressOf(profileId).map((p) => p.itemId));

/* ------------------------------------------------------------------ seed fixture */

const findSeedEpisode = (id) => {
  for (const s of series) {
    const ep = s.episodes.find((e) => e.id === id);
    if (ep) return ep;
  }
  return null;
};

const findSeed = (id) =>
  movies.find((m) => m.id === id) ||
  series.find((s) => s.id === id) ||
  findSeedEpisode(id);

const episodeOwner = (id) => series.find((s) => s.id === id) || null;

/**
 * An episode carries no rating of its own: the `Episode` typedef in contract.js has no maturity
 * field and no upstream publishes a per-episode genre or certificate, so an episode inherits the
 * rating of the series it belongs to. The owner is passed in because the two id namespaces reach
 * an episode differently, and looking it up from `seriesId` only ever finds the seed fixture.
 */
function withInheritedMaturity(item, owner) {
  if (item.maturity) return item;
  return owner?.maturity ? { ...item, maturity: owner.maturity } : item;
}

function seedBrowseItems(kind) {
  if (kind === 'movie') return movies;
  if (kind === 'series') return series;
  return [...movies, ...series];
}

const seedSearchItems = ({ text, kind }) => {
  const q = lower(text);
  return seedBrowseItems(kind).filter((item) => lower(item.title).includes(q));
};

/* ------------------------------------------------------------------ provider reads */

/**
 * `cache.get` never awaits a loader and a cold miss returns null, so the fetch lives here. An
 * empty list is indistinguishable from an upstream outage, so it is never persisted: caching one
 * would suppress the seed fallback for the whole TTL.
 */
async function throughCache(key, loader) {
  const hit = await cache.get(key);
  if (hit !== null) return hit;
  const value = await loader();
  if (value != null && !(Array.isArray(value) && value.length === 0)) {
    await cache.put(key, value);
  }
  return value;
}

/**
 * Every provider read goes through here, protected by an upstream Circuit Breaker.
 * Catches timeouts and upstream failures, tripping OPEN after repeated outages
 * so subsequent requests fast-fail to fallback without exhausting connection pools.
 */
async function providerCall(name, op, keyParts, call, fallback) {
  const adapter = adapterFor(name);
  if (!adapter) return fallback;
  const breaker = getCircuitBreaker(name, {
    failureThreshold: 5,
    resetTimeoutMs: 10000,
    callTimeoutMs: 5000,
  });
  return breaker.execute(async () => {
    const value = await throughCache(cacheKey(name, op, ...keyParts), () =>
      call(adapter),
    );
    return value == null ? fallback : value;
  }, fallback);
}

async function providerBrowseItems(kind, genre) {
  const items = await providerCall(
    providerForKind(kind),
    'browse',
    [kind ?? 'all', genre ?? '-'],
    (adapter) => adapter.browse({ kind, genre, limit: BROWSE_LIMIT }),
    [],
  );
  // The genre is re-applied rather than trusted from the adapter: `filter[genres]` silently
  // returns the entire catalog for a slug Kitsu cannot resolve, which turns a wrong genre into a
  // wrong rail instead of an empty one.
  return items.filter(
    (item) => !genre || itemGenres(item).includes(lower(genre)),
  );
}

const providerGetItem = (id) =>
  providerCall(
    providerForId(id),
    'get',
    [id],
    (adapter) => adapter.get(id),
    null,
  );

async function providerSearchItems(text, kind, limit) {
  const items = await providerCall(
    providerForKind(kind),
    'search',
    [kind ?? 'all', lower(text)],
    (adapter) => adapter.search(text, { kind, limit }),
    [],
  );
  // Cinemeta ignores the `search=` catalog path segment and answers with its top catalog, so its
  // hits are narrowed to the query here or the search box returns 100 unrelated titles.
  const q = lower(text);
  return items.filter((item) => lower(item.title).includes(q));
}

function providerEpisodes(item) {
  const name = providerForId(item.id);
  return providerCall(
    name,
    'episodes',
    [item.id],
    (adapter) => adapter.episodes(item),
    [],
  );
}

async function episodesOf(item) {
  const owned = episodeOwner(item.id);
  return owned ? owned.episodes : providerEpisodes(item);
}

/* ------------------------------------------------------------------ resolution */

async function resolveItem(id) {
  const wanted = String(id ?? '');
  if (!wanted) return null;
  const seeded = findSeed(wanted);
  if (seeded) {
    return {
      item: withInheritedMaturity(seeded, episodeOwner(seeded.seriesId)),
      source: 'seed',
    };
  }

  const ownerId = episodeOwnerId(wanted);
  if (ownerId) {
    const owner = await resolveItem(ownerId);
    if (!owner) return null;
    const episode = (await episodesOf(owner.item)).find((e) => e.id === wanted);
    return episode
      ? {
          item: withInheritedMaturity(episode, owner.item),
          source: owner.source,
        }
      : null;
  }

  const item = await providerGetItem(wanted);
  return item ? { item, source: 'provider' } : null;
}

/** Provider first, fixture second. */
async function browseItems(profile, kind, genre) {
  const fromProvider = visibleTo(
    profile,
    await providerBrowseItems(kind, genre),
  );
  if (fromProvider.length) return withSource(fromProvider, 'provider');
  return withSource(visibleTo(profile, seedBrowseItems(kind)), 'seed');
}

/**
 * One unwatched rule for both id namespaces: the first episode no progress row names, else the
 * first episode. Seed series and provider series differ in shape but agree on ordering.
 */
const nextUnwatched = (watched, episodes) =>
  episodes.find((ep) => !watched.has(ep.id)) ?? episodes[0] ?? null;

async function playback(profile, profileId, item, source) {
  if (source !== 'seed') {
    // The concrete thing that plays becomes resolvable by its own id, so history and any later
    // `get` on that id are a cache read instead of another upstream round trip.
    const name = providerForId(item.id);
    if (adapterFor(name)) {
      await cache.put(cacheKey(name, 'get', item.id), item);
    }
  }
  return {
    item: sourced(source)(item),
    manifestUrl: `/stream/${item.id}.m3u8`,
    resumeFromSeconds: savedSeconds(profileId, item.id),
  };
}

function playSeed(profile, profileId, ref, seeded) {
  if (ref.kind === 'movie' && seeded.kind === 'movie') {
    assertCanWatch(profile, seeded);
    return playback(profile, profileId, seeded, 'seed');
  }
  if (ref.kind === 'series' && seeded.kind === 'series') {
    assertCanWatch(profile, seeded);
    const episode = nextUnwatched(watchedIds(profileId), seeded.episodes);
    if (!episode) throw notFound('no such episode');
    return playback(profile, profileId, episode, 'seed');
  }
  if (ref.kind === 'episode' && seeded.seriesId) {
    const owner = episodeOwner(seeded.seriesId);
    assertCanWatch(profile, owner);
    return playback(profile, profileId, seeded, 'seed');
  }
  throw new DomainError('VALIDATION', 'unknown media kind');
}

async function playProvider(profile, profileId, ref) {
  const id = String(ref.id ?? '');
  if (!adapterFor(providerName())) throw notFound('no such title');

  if (ref.kind === 'movie') {
    const item = await providerGetItem(id);
    if (!item) throw notFound('no such movie');
    assertCanWatch(profile, item);
    return playback(
      profile,
      profileId,
      { ...item, durationSeconds: item.durationSeconds ?? 0 },
      'provider',
    );
  }
  if (ref.kind !== 'series' && ref.kind !== 'episode') {
    throw new DomainError('VALIDATION', 'unknown media kind');
  }

  // An episode ref has to name its series, because progress and the maturity gate hang off the
  // series rather than the episode. A ref no adapter can split falls through as its own id, which
  // is the TVmaze case: its episode ids name no series, so only the series ref can be played.
  const owner = await resolveItem(
    ref.kind === 'episode' ? (episodeOwnerId(id) ?? id) : id,
  );
  if (!owner) throw notFound('no such series');
  assertCanWatch(profile, owner.item);

  const episodes = await episodesOf(owner.item);
  const episode =
    ref.kind === 'episode'
      ? episodes.find((e) => e.id === id)
      : nextUnwatched(watchedIds(profileId), episodes);
  if (!episode) throw notFound('no such episode');
  return playback(profile, profileId, episode, owner.source);
}

/** The cache is the only source a history row may read, so a page render never fans out upstream. */
const cachedItem = (id) => {
  const name = providerForId(id);
  return adapterFor(name) ? cache.get(cacheKey(name, 'get', id)) : null;
};

/**
 * A provider id resolves from the cache only. `play` already cached the item it handed back, so
 * a title the profile actually watched resolves here, and a continue-watching rail never fans
 * out one upstream request per row on a page render.
 */
async function historyItem(id) {
  const seeded = findSeed(id);
  if (seeded) {
    return {
      item: withInheritedMaturity(seeded, episodeOwner(seeded.seriesId)),
      source: 'seed',
    };
  }
  const cached = await cachedItem(id);
  if (!cached) return null;
  // An episode carries no rating of its own, so it inherits the owning series the same way
  // `resolveItem` inherits it. `play` cached that series on its way to the episode, and the
  // cached episode names its owner, so this costs a cache read and not an upstream round trip.
  const ownerId = cached.seriesId ?? episodeOwnerId(id);
  const owner = ownerId ? await cachedItem(ownerId) : null;
  return { item: withInheritedMaturity(cached, owner), source: 'provider' };
}

/* ------------------------------------------------------------------ service */

export const CatalogService = {
  async browse(profileId, kind, { genre } = {}) {
    return { items: await browseItems(requireProfile(profileId), kind, genre) };
  },

  /** Both id namespaces: `seed:m1` and `seed:s1:1:1` from the fixture, `tt0111161` from the provider. */
  async get(profileId, id) {
    const profile = requireProfile(profileId);
    const found = await resolveItem(String(id ?? ''));
    // A gated title is reported as absent rather than blocked, so the endpoint does not confirm
    // that an adult title exists.
    if (!found || !maturityAllowed(profile.maturity, found.item.maturity)) {
      throw notFound('no such title');
    }
    return sourced(found.source)(found.item);
  },

  /**
   * The fixture answers first because it is deterministic and the repo gate pins its results.
   * Every query it cannot answer goes to a provider, which is every real query including all of
   * `kind=anime`.
   */
  async search(profileId, { text, kind, cursor, limit = 20 } = {}) {
    const profile = requireProfile(profileId);
    const seeded = seedSearchItems({ text, kind });
    const hits = visibleTo(
      profile,
      seeded.length ? seeded : await providerSearchItems(text, kind, limit),
    );
    const from = Math.max(0, Number.parseInt(cursor, 10) || 0);
    const size = Math.max(1, Number(limit) || 20);
    return {
      items: withSource(
        hits.slice(from, from + size),
        seeded.length ? 'seed' : 'provider',
      ),
      nextCursor: from + size < hits.length ? String(from + size) : null,
    };
  },

  /** A genre match is the whole recommendation. No scoring engine, by design. */
  async related(profileId, id, { limit = RELATED_LIMIT } = {}) {
    const profile = requireProfile(profileId);
    const anchor = await resolveItem(String(id ?? ''));
    if (!anchor || !maturityAllowed(profile.maturity, anchor.item.maturity)) {
      throw notFound('no such title');
    }

    const kind = anchor.item.kind === 'series' ? 'series' : 'movie';
    const pool = (await browseItems(profile, kind)).filter(
      (item) => item.id !== anchor.item.id,
    );
    const shared = new Set(itemGenres(anchor.item));
    const byGenre = pool.filter((item) =>
      itemGenres(item).some((g) => shared.has(g)),
    );
    return { items: (byGenre.length ? byGenre : pool).slice(0, limit) };
  },

  async play(accountId, profileId, ref) {
    const profile = requireProfile(profileId);
    if (!ref || typeof ref !== 'object') {
      throw new DomainError('VALIDATION', 'unknown media kind');
    }
    const seeded = findSeed(String(ref.id ?? ''));
    return seeded
      ? playSeed(profile, profileId, ref, seeded)
      : playProvider(profile, profileId, ref);
  },

  /**
   * A progress row is a claim that this profile watched the item, so it is gated exactly as a
   * read is: the item is resolved first and the write happens only if the same `resolveItem` the
   * read paths use says the profile may see it. An id that resolves to nothing is refused with
   * the same error as a gated one, so this endpoint cannot be used to ask which titles exist.
   */
  async recordProgress(profileId, { itemId, seconds }) {
    const profile = requireProfile(profileId);
    const id = String(itemId);
    const found = await resolveItem(id);
    if (!found) {
      throw new DomainError(
        'MATURITY_BLOCKED',
        'not available for this profile',
      );
    }
    assertCanWatch(profile, found.item);
    const entry = {
      profileId,
      itemId: id,
      seconds: Number(seconds) || 0,
      updatedAt: new Date().toISOString(),
    };
    db.progress.set(`${profileId}:${id}`, entry);
    return entry;
  },

  /**
   * Every row is gated through `visibleTo` before it is returned, and a row that resolves to
   * nothing this profile may see is dropped rather than returned with a null item: the stored
   * watch position survives either way, and a kept row would name a title the profile is not
   * allowed to know about while spending one of the `limit` slots.
   */
  async history(profileId, { limit = 20 } = {}) {
    const profile = requireProfile(profileId);
    const rows = progressOf(profileId).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    const entries = await Promise.all(
      rows.map(async (row) => ({ row, found: await historyItem(row.itemId) })),
    );
    return entries
      .filter(
        ({ found }) => found && visibleTo(profile, [found.item]).length > 0,
      )
      .map(({ row, found }) => ({
        ...row,
        item: sourced(found.source)(found.item),
      }))
      .slice(0, limit);
  },
};
