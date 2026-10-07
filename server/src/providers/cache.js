/** File-backed CacheStore. The interface is contract.js; adapters import only this. */
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_DIR = '/tmp/opencode/cflix-cache';
const DEFAULT_TTL_MS = 86_400_000;
/**
 * How many entry files the directory may hold before a sweep evicts. `search` is keyed on the
 * query string and Cinemeta answers every query with its whole top catalog, so without a cap one
 * user's typos become permanent ~100-item files.
 */
const DEFAULT_MAX_ENTRIES = 500;
const ignore = () => {};

/**
 * Whether a value is worth persisting. An empty list is indistinguishable from an upstream
 * outage, so caching one suppresses the caller's seed fallback for the whole TTL.
 */
export const cacheable = (value) =>
  value != null && !(Array.isArray(value) && value.length === 0);

/**
 * @typedef {Object} Entry
 * @property {string} key
 * @property {number} savedAt
 * @property {any} value
 */

/**
 * In-memory Least Recently Used (LRU) cache for sub-millisecond L1 lookups.
 */
class LruMemoryCache {
  /** @param {number} max */
  constructor(max = 500) {
    this.max = max;
    /** @type {Map<string, { value: any, savedAt: number, mtimeMs: number }>} */
    this.cache = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    this.cache.delete(key);
    this.cache.set(key, item);
    return item;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}
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
  // An empty or blank setting means unset, which is the default rather than the 0 that
  // `Number('')` would otherwise report: `CFLIX_CACHE_TTL_MS=0` is a deliberate operator choice
  // and it has to stay distinguishable from a variable exported without a value.
  const rawTtl = options.ttlMs ?? process.env.CFLIX_CACHE_TTL_MS;
  const ttl =
    rawTtl == null || String(rawTtl).trim() === '' ? NaN : Number(rawTtl);
  const ttlMs = Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_TTL_MS;
  const maxEntries = Math.max(
    1,
    Number(options.maxEntries) || DEFAULT_MAX_ENTRIES,
  );
  const l1Capacity = Number(options.l1Capacity) || 500;
  // 0 is what an operator setting a TTL of 0 means: cache nothing. It used to mean "always
  // expired", and an always-expired entry was served anyway, so it meant cache forever and never
  // revalidate — the one value an operator would never choose.
  if (ttlMs === 0) {
    const noRead = async () => null;
    const noWrite = async () => {};
    return { get: noRead, put: noWrite, invalidate: noWrite };
  }
  const l1 = new LruMemoryCache(l1Capacity);
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

    // L1 Memory Cache Lookup
    const l1Entry = l1.get(key);
    if (l1Entry) {
      try {
        const fileStat = await stat(path);
        if (fileStat.mtimeMs === l1Entry.mtimeMs) {
          if (Date.now() - l1Entry.savedAt < ttlMs) return l1Entry.value;
          const known = loaders.get(key);
          if (known) refresh(key, known);
          return l1Entry.value;
        }
      } catch (err) {
        if (err.code === 'ENOENT') {
          l1.delete(key);
          return null;
        }
      }
    }

    // L2 Disk Cache Lookup
    const entry = await read(key, path);
    if (!entry) {
      l1.delete(key);
      return null;
    }

    // Populate L1 cache with disk mtime for fast revalidation
    try {
      const fileStat = await stat(path);
      l1.set(key, {
        value: entry.value,
        savedAt: entry.savedAt,
        mtimeMs: fileStat.mtimeMs,
      });
    } catch {
      l1.set(key, {
        value: entry.value,
        savedAt: entry.savedAt,
        mtimeMs: 0,
      });
    }

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
      const now = Date.now();
      // Rename is atomic, so a concurrent reader never parses a half-written file and
      // a process killed mid-write leaves the previous entry intact.
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify({ key, savedAt: now, value }));
      await rename(tmp, path);
      try {
        const fileStat = await stat(path);
        l1.set(key, { value, savedAt: now, mtimeMs: fileStat.mtimeMs });
      } catch {
        l1.delete(key);
      }
      // A sweep is a directory scan, so it runs off the write path rather than inside it. An
      // error here leaves the entry written, which is the only outcome that matters.
      sweep(path).catch(ignore);
    }).catch((err) => warn(`cache write failed for ${key}`, err));
  }

  /** @returns {Promise<void>} */
  function invalidate(key) {
    l1.delete(key);
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
        // Storing the loader's own null, or an empty list an outage produced, would turn a
        // transient upstream failure into a hit that suppresses the caller's fallback.
        .then((value) => (cacheable(value) ? put(key, value) : null))
        .catch((err) => warn(`cache refresh failed for ${key}`, err))
        .finally(() => refreshing.delete(key)),
    );
  }

  /**
   * Evicts the oldest entries once the directory is over `maxEntries`, down to a low-water mark
   * so the sweep costs one pass per `maxEntries / 5` writes rather than one per write. Least
   * recently written is the only order the disk layer can know: it stores no read time, and an
   * entry that is never read again is the one worth dropping. `keepPath` is the file the caller
   * just wrote, which a same-millisecond mtime tie could otherwise pick.
   */
  async function sweep(keepPath) {
    let names;
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    const files = names.filter((name) => name.endsWith('.json'));
    if (files.length <= maxEntries) return;
    const keepEntries = Math.max(1, Math.floor(maxEntries * 0.8));
    const stamped = await Promise.all(
      files.map(async (name) => {
        const path = join(dir, name);
        if (path === keepPath) return null;
        try {
          return { path, mtimeMs: (await stat(path)).mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    const doomed = stamped
      .filter(Boolean)
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .slice(0, files.length - keepEntries);
    // The filename is a hash of the key, so an evicted file cannot be mapped back to its L1
    // entry. It does not have to be: `get` stats the file it wants, finds it gone, and drops the
    // memory entry then.
    await Promise.all(
      doomed.map(({ path }) => rm(path, { force: true }).catch(ignore)),
    );
  }

  return { get, put, invalidate };
}

/** Reads CFLIX_CACHE_DIR and CFLIX_CACHE_TTL_MS once, at import. */
export const cache = createCacheStore();
