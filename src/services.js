import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, newId, findAccountByEmail, profilesOf, progressOf } from './store.js';
import { movies, series, seriesListing } from './catalog-data.js';
import { maturityAllowed } from './types.js';

class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function hashPassword(password, salt = randomBytes(8).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = scryptSync(password, salt, 32);
  return timingSafeEqual(attempt, Buffer.from(hash, 'hex'));
}

function issueSession(accountId) {
  const token = randomBytes(16).toString('hex');
  db.sessions.set(token, { accountId, expiresAt: Date.now() + 7 * 24 * 3600e3 });
  return { token, expiresAt: Date.now() + 7 * 24 * 3600e3 };
}

export const AuthService = {
  signUp({ email, password }) {
    if (findAccountByEmail(email)) throw new DomainError('EMAIL_TAKEN', 'email already registered');
    const account = { id: newId('u'), email, provider: 'email', passwordHash: hashPassword(password) };
    db.accounts.set(account.id, account);
    return { user: publicAccount(account), session: issueSession(account.id) };
  },

  signIn({ email, password }) {
    const account = findAccountByEmail(email);
    if (!account || !account.passwordHash || !checkPassword(password, account.passwordHash)) {
      throw new DomainError('INVALID_CREDENTIALS', 'bad email or password');
    }
    return { user: publicAccount(account), session: issueSession(account.id) };
  },

  // Google stub: idToken is "google:<email>". Local stand-in for JWKS verify.
  // Merges by email: existing account (any provider) gets a session.
  signInWithGoogle({ idToken }) {
    if (!idToken || !idToken.startsWith('google:')) throw new DomainError('INVALID_GOOGLE_TOKEN', 'bad token');
    const email = idToken.slice('google:'.length).trim();
    if (!email) throw new DomainError('INVALID_GOOGLE_TOKEN', 'no email in token');
    let account = findAccountByEmail(email);
    if (!account) {
      account = { id: newId('u'), email, provider: 'google', passwordHash: null };
      db.accounts.set(account.id, account);
    }
    return { user: publicAccount(account), session: issueSession(account.id) };
  },

  refresh(token) {
    const s = db.sessions.get(token);
    if (!s || s.expiresAt < Date.now()) throw new DomainError('SESSION_EXPIRED', 'expired');
    db.sessions.delete(token);
    return issueSession(s.accountId);
  },

  signOut(token) {
    db.sessions.delete(token);
  },

  accountForToken(token) {
    const s = db.sessions.get(token);
    if (!s || s.expiresAt < Date.now()) throw new DomainError('SESSION_EXPIRED', 'expired');
    return db.accounts.get(s.accountId);
  },
};

export const ProfileService = {
  list(accountId) {
    return profilesOf(accountId);
  },
  create(accountId, { name, maturity }) {
    const existing = profilesOf(accountId);
    if (existing.length >= 5) throw new DomainError('PROFILE_LIMIT', 'max 5 profiles');
    if (!name || !name.trim()) throw new DomainError('VALIDATION', 'name required');
    const profile = { id: newId('p'), accountId, name: name.trim(), maturity: maturity || 'adult' };
    db.profiles.set(profile.id, profile);
    return profile;
  },
  update(accountId, id, patch) {
    const p = db.profiles.get(id);
    if (!p || p.accountId !== accountId) throw new DomainError('NOT_FOUND', 'no such profile');
    Object.assign(p, patch);
    return p;
  },
  remove(accountId, id) {
    const p = db.profiles.get(id);
    if (!p || p.accountId !== accountId) throw new DomainError('NOT_FOUND', 'no such profile');
    db.profiles.delete(id);
  },
};

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

  // Series play resolves the profile's next unwatched episode.
  play(accountId, profileId, ref) {
    requireProfile(profileId);
    if (ref.kind === 'movie') {
      const m = movies.find((x) => x.id === ref.id);
      if (!m) throw new DomainError('NOT_FOUND', 'no such movie');
      assertCanWatch(profileId, m);
      return { item: m, manifestUrl: `/stream/${m.id}.m3u8`, resumeFromSeconds: savedSeconds(profileId, m.id) };
    }
    if (ref.kind === 'episode') {
      const ep = findEpisode(ref.id);
      if (!ep) throw new DomainError('NOT_FOUND', 'no such episode');
      const s = series.find((x) => x.id === ep.seriesId);
      assertCanWatch(profileId, s);
      return { item: ep, manifestUrl: `/stream/${ep.id}.m3u8`, resumeFromSeconds: savedSeconds(profileId, ep.id) };
    }
    // series
    const s = series.find((x) => x.id === ref.id);
    if (!s) throw new DomainError('NOT_FOUND', 'no such series');
    assertCanWatch(profileId, s);
    const ep = nextUnwatchedEpisode(profileId, s);
    return { item: ep, manifestUrl: `/stream/${ep.id}.m3u8`, resumeFromSeconds: savedSeconds(profileId, ep.id) };
  },

  recordProgress(profileId, { itemId, seconds }) {
    requireProfile(profileId);
    const id = String(itemId);
    const entry = { profileId, itemId: id, seconds: Number(seconds) || 0, updatedAt: new Date().toISOString() };
    db.progress.set(`${profileId}:${id}`, entry);
    return entry;
  },

  history(profileId, { limit = 20 } = {}) {
    requireProfile(profileId);
    return progressOf(profileId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((p) => ({ ...p, item: findItem(p.itemId) || findEpisode(p.itemId) || null }));
  },
};

function requireProfile(profileId) {
  const p = db.profiles.get(profileId);
  if (!p) throw new DomainError('NOT_FOUND', 'no such profile');
  return p;
}

function findItem(id) {
  return movies.find((m) => m.id === id) || series.find((s) => s.id === id) || null;
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

function publicAccount(a) {
  return { id: a.id, email: a.email, provider: a.provider };
}
