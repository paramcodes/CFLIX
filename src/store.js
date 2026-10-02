// In-memory store. The only module that touches the maps.

const accounts = new Map();      // id -> account
const profiles = new Map();      // id -> profile
const progress = new Map();      // `${profileId}:${itemId}` -> WatchPosition
const sessions = new Map();      // token -> { accountId, expiresAt }

let nextId = 1;

export function newId(prefix) {
  return `${prefix}_${nextId++}`;
}

export const db = {
  accounts, profiles, progress, sessions,
};

export function findAccountByEmail(email) {
  for (const a of accounts.values()) if (a.email === email) return a;
  return null;
}

export function profilesOf(accountId) {
  return [...profiles.values()].filter((p) => p.accountId === accountId);
}

export function progressOf(profileId) {
  return [...progress.values()].filter((p) => p.profileId === profileId);
}
