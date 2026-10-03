import { db, progressOf } from './store.js';
import { movies, series, seriesListing } from './catalog-data.js';
import { maturityAllowed } from './types.js';
import { DomainError } from './errors.js';

function requireProfile(profileId) {
  const p = db.profiles.get(profileId);
  if (!p) throw new DomainError('NOT_FOUND', 'no such profile');
  return p;
}

function findItem(id) {
  return (
    movies.find((m) => m.id === id) || series.find((s) => s.id === id) || null
  );
}

function findEpisode(id) {
  for (const s of series) {
    for (const season of s.seasons) {
      const ep = season.episodes.find((e) => e.id === id);
      if (ep) return ep;
    }
  }
  return null;
}

function nextUnwatchedEpisode(profileId, s) {
  const watched = new Set(progressOf(profileId).map((p) => p.itemId));
  for (const season of s.seasons) {
    for (const ep of season.episodes) {
      if (!watched.has(ep.id)) return ep;
    }
  }
  return s.seasons[0].episodes[0];
}

function savedSeconds(profileId, itemId) {
  const p = progressOf(profileId).find((x) => x.itemId === String(itemId));
  return p ? p.seconds : 0;
}

function assertCanWatch(profileId, item) {
  const profile = requireProfile(profileId);
  if (!maturityAllowed(profile.maturity, item.maturity)) {
    throw new DomainError('MATURITY_BLOCKED', 'not available for this profile');
  }
}

export const CatalogService = {
  browse(profileId, kind) {
    const profile = requireProfile(profileId);
    const moviesAllowed = movies.filter((m) =>
      maturityAllowed(profile.maturity, m.maturity),
    );
    const seriesAllowed = series
      .filter((s) => maturityAllowed(profile.maturity, s.maturity))
      .map(seriesListing);
    if (kind === 'movie') return { items: moviesAllowed };
    if (kind === 'series') return { items: seriesAllowed };
    return { items: [...moviesAllowed, ...seriesAllowed] };
  },

  get(profileId, id) {
    const profile = requireProfile(profileId);
    const item = findItem(id);
    if (!item || !maturityAllowed(profile.maturity, item.maturity))
      throw new DomainError('NOT_FOUND', 'no such title');
    return item;
  },

  search(profileId, { text, kind, cursor, limit = 20 }) {
    const profile = requireProfile(profileId);
    const q = (text || '').toLowerCase();
    const pool = [
      ...movies.map((m) => ({ ...m })),
      ...series.map(seriesListing),
    ];
    const hits = pool.filter(
      (item) =>
        (kind ? item.kind === kind : true) &&
        maturityAllowed(profile.maturity, item.maturity) &&
        item.title.toLowerCase().includes(q),
    );
    return { items: hits.slice(0, limit), nextCursor: null };
  },

  play(accountId, profileId, ref) {
    requireProfile(profileId);
    if (ref.kind === 'movie') {
      const m = movies.find((x) => x.id === ref.id);
      if (!m) throw new DomainError('NOT_FOUND', 'no such movie');
      assertCanWatch(profileId, m);
      return {
        item: m,
        manifestUrl: `/stream/${m.id}.m3u8`,
        resumeFromSeconds: savedSeconds(profileId, m.id),
      };
    }
    if (ref.kind === 'episode') {
      const ep = findEpisode(ref.id);
      if (!ep) throw new DomainError('NOT_FOUND', 'no such episode');
      const s = series.find((x) => x.id === ep.seriesId);
      assertCanWatch(profileId, s);
      return {
        item: ep,
        manifestUrl: `/stream/${ep.id}.m3u8`,
        resumeFromSeconds: savedSeconds(profileId, ep.id),
      };
    }
    if (ref.kind === 'series') {
      const s = series.find((x) => x.id === ref.id);
      if (!s) throw new DomainError('NOT_FOUND', 'no such series');
      assertCanWatch(profileId, s);
      const ep = nextUnwatchedEpisode(profileId, s);
      return {
        item: ep,
        manifestUrl: `/stream/${ep.id}.m3u8`,
        resumeFromSeconds: savedSeconds(profileId, ep.id),
      };
    }
    throw new DomainError('VALIDATION', 'unknown media kind');
  },

  recordProgress(profileId, { itemId, seconds }) {
    requireProfile(profileId);
    const id = String(itemId);
    const entry = {
      profileId,
      itemId: id,
      seconds: Number(seconds) || 0,
      updatedAt: new Date().toISOString(),
    };
    db.progress.set(`${profileId}:${id}`, entry);
    return entry;
  },

  history(profileId, { limit = 20 } = {}) {
    requireProfile(profileId);
    return progressOf(profileId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((p) => ({
        ...p,
        item: findItem(p.itemId) || findEpisode(p.itemId) || null,
      }));
  },
};
