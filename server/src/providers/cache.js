/** File-backed CacheStore. The interface is contract.js; adapters import only this. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_DIR = '/tmp/opencode/cflix-cache';
const DEFAULT_TTL_MS = 86_400_000;
const ignore = () => {};

/**
 * @typedef {Object} Entry
 * @property {string} key
 * @property {number} savedAt
 * @property {any} value
 */

function parseEntry(text, key) {
  const entry = JSON.parse(text);
  if (
    !entry ||
    typeof entry !== 'object' ||
    entry.key !== key ||
    !Number.isFinite(entry.savedAt) ||
    !('value' in entry)
  ) {
    throw new TypeError(`cache entry for ${key} is not an entry`);
  }
  return entry;
}

export function createCacheStore(options = {}) {
  const dir = options.dir || process.env.CFLIX_CACHE_DIR || DEFAULT_DIR;
  const rawTtl = options.ttlMs ?? (process.env.CFLIX_CACHE_TTL_MS || undefined);
  const ttl = Number(rawTtl);
  const ttlMs = Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_TTL_MS;

  /** @type {Map<string, Promise<unknown>>} */
  const writes = new Map();
  /** @type {Map<string, () => Promise<any>>} */
  const loaders = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const refreshing = new Map();
  const warned = new Set();

  const pathFor = (key) =>
    join(dir, `${createHash('sha256').update(key).digest('hex')}.json`);

  function warn(message, err) {
    process.emitWarning(`${message}: ${err?.message ?? err}`);
  }

  function warnOnce(path, message, err) {
    if (warned.has(path)) return;
    warned.add(path);
    warn(message, err);
  }

  function serialize(path, op) {
    const settled = (writes.get(path) || Promise.resolve()).then(op, op);
    const tail = settled.then(ignore, ignore);
    writes.set(path, tail);
    tail.then(() => {
      if (writes.get(path) === tail) writes.delete(path);
    });
    return settled;
  }

  async function read(key, path) {
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        warnOnce(path, `cache read failed for ${key}`, err);
      }
      return null;
    }
    try {
      return parseEntry(text, key);
    } catch (err) {
      warnOnce(path, `cache file corrupt for ${key}`, err);
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {() => Promise<any>} [loader] Remembered so a stale entry can refresh
   *   itself. A cold miss still returns null and leaves fetching to the caller.
   * @returns {Promise<any|null>}
   */
  async function get(key, loader) {
    if (loader) loaders.set(key, loader);
    const path = pathFor(key);
    await writes.get(path);
    const entry = await read(key, path);
    if (!entry) return null;
    if (Date.now() - entry.savedAt < ttlMs) return entry.value;
    const known = loaders.get(key);
    if (known) refresh(key, known);
    return entry.value;
  }

  /** @returns {Promise<void>} */
  function put(key, value) {
    if (value === undefined) return invalidate(key);
    const path = pathFor(key);
    return serialize(path, async () => {
      await mkdir(dir, { recursive: true });
      // Rename is atomic, so a concurrent reader never parses a half-written file and
      // a process killed mid-write leaves the previous entry intact.
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify({ key, savedAt: Date.now(), value }));
      await rename(tmp, path);
    }).catch((err) => warn(`cache write failed for ${key}`, err));
  }

  /** @returns {Promise<void>} */
  function invalidate(key) {
    const path = pathFor(key);
    return serialize(path, () => rm(path, { force: true })).catch((err) =>
      warn(`cache invalidate failed for ${key}`, err),
    );
  }

  function refresh(key, loader) {
    if (refreshing.has(key)) return;
    refreshing.set(
      key,
      Promise.resolve()
        .then(loader)
        // Storing the loader's own null would turn a miss into a hit that serves null.
        .then((value) => (value == null ? null : put(key, value)))
        .catch((err) => warn(`cache refresh failed for ${key}`, err))
        .finally(() => refreshing.delete(key)),
    );
  }

  return { get, put, invalidate };
}

/** Reads CFLIX_CACHE_DIR and CFLIX_CACHE_TTL_MS once, at import. */
export const cache = createCacheStore();
