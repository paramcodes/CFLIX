import { db, newId, profilesOf } from './store.js';
import { DomainError } from './errors.js';

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
