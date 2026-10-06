import {
  DrizzleAccountRepository,
  DrizzleSessionRepository,
  DrizzleProfileRepository,
  DrizzleProgressRepository,
} from './db/repositories.js';

/**
 * Domain Repositories.
 * Services should prefer importing these repository ports directly.
 */
export const accountRepo = new DrizzleAccountRepository();
export const sessionRepo = new DrizzleSessionRepository();
export const profileRepo = new DrizzleProfileRepository();
export const progressRepo = new DrizzleProgressRepository();

let idCounter = 1;
export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${idCounter++}`;
}

/**
 * Backwards-compatible Map adapters backed by Drizzle repositories.
 * Allows existing synchronous callers to interact with the database
 * without breaking legacy contracts or test fixtures.
 */
class AccountStoreAdapter {
  get(id) {
    return accountRepo.findById(id);
  }
  set(id, account) {
    accountRepo.save({ ...account, id });
    return this;
  }
  values() {
    return accountRepo.listAll()[Symbol.iterator]();
  }
}

class SessionStoreAdapter {
  get(token) {
    return sessionRepo.findByToken(token);
  }
  set(token, session) {
    sessionRepo.save({ ...session, token });
    return this;
  }
  delete(token) {
    sessionRepo.delete(token);
  }
}

class ProfileStoreAdapter {
  get(id) {
    return profileRepo.findById(id);
  }
  set(id, profile) {
    profileRepo.save({ ...profile, id });
    return this;
  }
  delete(id) {
    profileRepo.delete(id);
  }
  values() {
    return profileRepo.listAll()[Symbol.iterator]();
  }
}

class ProgressStoreAdapter {
  get(key) {
    const [profileId, itemId] = key.split(':');
    return progressRepo.findByItem(profileId, itemId);
  }
  set(key, entry) {
    progressRepo.save({ ...entry, id: key });
    return this;
  }
  values() {
    return progressRepo.listAll()[Symbol.iterator]();
  }
}

export const db = {
  accounts: new AccountStoreAdapter(),
  sessions: new SessionStoreAdapter(),
  profiles: new ProfileStoreAdapter(),
  progress: new ProgressStoreAdapter(),
};

export function findAccountByEmail(email) {
  return accountRepo.findByEmail(email);
}

export function profilesOf(accountId) {
  return profileRepo.listByAccountId(accountId);
}

export function progressOf(profileId) {
  return progressRepo.listByProfileId(profileId);
}
