import { newId, profileRepo as defaultProfileRepo } from './store.js';
import { DomainError } from './errors.js';

/**
 * Factory for creating a ProfileService instance with injected repository.
 *
 * @param {Object} [deps]
 * @param {import('./domain/ports.js').ProfileRepositoryPort} [deps.profileRepo]
 */
export function createProfileService({
  profileRepo = defaultProfileRepo,
} = {}) {
  return {
    list(accountId) {
      return profileRepo.listByAccountId(accountId);
    },

    create(accountId, { name, maturity }) {
      const existing = profileRepo.listByAccountId(accountId);
      if (existing.length >= 5) {
        throw new DomainError('PROFILE_LIMIT', 'max 5 profiles');
      }
      if (!name || !name.trim()) {
        throw new DomainError('VALIDATION', 'name required');
      }
      const profile = {
        id: newId('p'),
        accountId,
        name: name.trim(),
        maturity: maturity || 'adult',
      };
      profileRepo.save(profile);
      return profile;
    },

    update(accountId, id, patch) {
      const p = profileRepo.findById(id);
      if (!p || p.accountId !== accountId) {
        throw new DomainError('NOT_FOUND', 'no such profile');
      }
      const updated = { ...p, ...patch };
      profileRepo.save(updated);
      return updated;
    },

    remove(accountId, id) {
      const p = profileRepo.findById(id);
      if (!p || p.accountId !== accountId) {
        throw new DomainError('NOT_FOUND', 'no such profile');
      }
      profileRepo.delete(id);
    },
  };
}

export const ProfileService = createProfileService();
