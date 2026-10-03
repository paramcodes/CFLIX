/** @type {Map<string, object>} */
const accounts = new Map();
/** @type {Map<string, object>} */
const profiles = new Map();
/** @type {Map<string, object>} */
const progress = new Map();
/** @type {Map<string, { accountId: string, expiresAt: number }>} */
const sessions = new Map();

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
