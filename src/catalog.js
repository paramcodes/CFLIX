import { movies, series, seriesListing } from './catalog-data.js';
import { maturityAllowed } from './types.js';
import { DomainError } from './errors.js';
import { requireProfile } from './profiles.js';
import { PlaybackService } from './playback.js';

function findItem(id) {
  return movies.find((m) => m.id === id) || series.find((s) => s.id === id) || null;
}

export const CatalogService = {
  browse(profileId, kind) {
    const profile = requireProfile(profileId);
    const moviesAllowed = movies.filter((m) => maturityAllowed(profile.maturity, m.maturity));
    const seriesAllowed = series.filter((s) => maturityAllowed(profile.maturity, s.maturity)).map(seriesListing);
    if (kind === 'movie') return { items: moviesAllowed };
    if (kind === 'series') return { items: seriesAllowed };
    return { items: [...moviesAllowed, ...seriesAllowed] };
  },

  get(profileId, id) {
    const profile = requireProfile(profileId);
    const item = findItem(id);
    if (!item || !maturityAllowed(profile.maturity, item.maturity)) throw new DomainError('NOT_FOUND', 'no such title');
    return item;
  },

  search(profileId, { text, kind, cursor, limit = 20 }) {
    const profile = requireProfile(profileId);
    const q = (text || '').toLowerCase();
    const pool = [
      ...movies.map((m) => ({ ...m })),
      ...series.map(seriesListing),
    ];
    const hits = pool.filter((item) =>
      (kind ? item.kind === kind : true) &&
      maturityAllowed(profile.maturity, item.maturity) &&
      item.title.toLowerCase().includes(q),
    );
    return { items: hits.slice(0, limit), nextCursor: null };
  },

  play(accountId, profileId, ref) {
    return PlaybackService.play(accountId, profileId, ref);
  },

  recordProgress(profileId, data) {
    return PlaybackService.recordProgress(profileId, data);
  },

  history(profileId, opts) {
    return PlaybackService.history(profileId, opts);
  },
};
