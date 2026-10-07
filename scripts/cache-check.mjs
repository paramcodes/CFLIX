import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  cache as defaultCache,
  createCacheStore,
} from '../server/src/providers/cache.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const scratch = await mkdtemp('/tmp/opencode/cflix-cache-check-');

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}
function show(value) {
  const text = JSON.stringify(value);
  return text.length > 200
    ? `${text.slice(0, 200)}...(${text.length} chars)`
    : text;
}
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(ok ? name : `${name} (got ${show(actual)})`, ok);
}
/** A directory that was never created holds no files, which is what "wrote nothing" means. */
const jsonFiles = async (dir) => {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};
const within = async (ms, promise) =>
  Promise.race([promise, sleep(ms).then(() => 'did not settle')]);

{
  const store = createCacheStore({ dir: join(scratch, 'basic') });
  const catalog = {
    kind: 'movie',
    id: 'tt0111161',
    title: 'The Shawshank Redemption',
    genres: ['drama'],
    backdropUrl: null,
  };
  eq(
    'an unwritten key reads as a miss',
    await store.get('cinemeta:movie:1'),
    null,
  );
  await store.put('cinemeta:movie:1', catalog);
  eq(
    'put then get returns the value',
    await store.get('cinemeta:movie:1'),
    catalog,
  );

  await store.put('cinemeta:series:1', { kind: 'series', id: 's1' });
  eq(
    'a second key reads back its own value',
    await store.get('cinemeta:series:1'),
    {
      kind: 'series',
      id: 's1',
    },
  );
  eq(
    'the first key is untouched by the second',
    await store.get('cinemeta:movie:1'),
    catalog,
  );

  await store.invalidate('cinemeta:movie:1');
  eq('invalidate drops the entry', await store.get('cinemeta:movie:1'), null);
  eq(
    'invalidate leaves other keys alone',
    await store.get('cinemeta:series:1'),
    {
      kind: 'series',
      id: 's1',
    },
  );
}

{
  const dir = join(scratch, 'ttl');
  const store = createCacheStore({ dir, ttlMs: 30 });
  const reader = createCacheStore({ dir, ttlMs: 60_000 });
  await store.put('k', { v: 'stale-me' });
  await sleep(5);
  eq('an entry inside the TTL is served', await store.get('k'), {
    v: 'stale-me',
  });
  await sleep(60);
  eq(
    'an expired entry still returns the stale value',
    await store.get('k', async () => ({ v: 'revalidated' })),
    { v: 'stale-me' },
  );
  await sleep(50);
  eq('the expired entry revalidated in the background', await reader.get('k'), {
    v: 'revalidated',
  });
}

{
  const dir = join(scratch, 'swr');
  // A TTL of 1ms rather than 0: 0 means the cache is disabled, so a store built with it serves
  // nothing and there is no stale entry left to revalidate.
  const store = createCacheStore({ dir, ttlMs: 1 });
  const reader = createCacheStore({ dir, ttlMs: 60_000 });
  let calls = 0;
  const loader = async () => {
    calls++;
    await sleep(20);
    return { title: 'refreshed' };
  };
  await store.put('k', { title: 'stale' });

  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  await sleep(20);
  eq(
    'get settles while a loader is still pending',
    await within(
      2000,
      store.get('k', () => gate),
    ),
    { title: 'stale' },
  );
  release({ title: 'refreshed' });
  await sleep(50);
  eq('the pending loader stored its value', await reader.get('k'), {
    title: 'refreshed',
  });

  await store.put('k', { title: 'stale' });
  await sleep(20);
  calls = 0;
  const [first, second] = await Promise.all([
    store.get('k', loader),
    store.get('k', loader),
  ]);
  eq(
    'two stale reads both return the stale value',
    [first, second],
    [{ title: 'stale' }, { title: 'stale' }],
  );
  await sleep(80);
  eq('a stale read refreshes in the background', await reader.get('k'), {
    title: 'refreshed',
  });
  eq('concurrent stale reads share one refresh', calls, 1);
}

{
  const dir = join(scratch, 'broken-refresh');
  const store = createCacheStore({ dir, ttlMs: 1 });
  const reader = createCacheStore({ dir, ttlMs: 60_000 });
  await store.put('k', { title: 'stale' });
  await sleep(20);
  eq(
    'a failing loader does not reach the caller',
    await within(
      2000,
      store.get('k', async () => {
        throw new Error('provider is down');
      }),
    ),
    { title: 'stale' },
  );
  await sleep(50);
  eq('a failed refresh leaves the entry intact', await reader.get('k'), {
    title: 'stale',
  });
}

{
  const dir = join(scratch, 'uncacheable-refresh');
  const store = createCacheStore({ dir, ttlMs: 1 });
  const reader = createCacheStore({ dir, ttlMs: 60_000 });
  await store.put('k', { title: 'stale' });
  await sleep(20);
  await store.get('k', async () => []);
  await sleep(50);
  eq(
    'an empty list is not stored by a refresh',
    await reader.get('k'),
    { title: 'stale' },
  );
}

{
  const dir = join(scratch, 'eviction');
  const store = createCacheStore({ dir, ttlMs: 60_000, maxEntries: 5 });
  const keys = Array.from({ length: 30 }, (_, i) => `cinemeta:search:all:term ${i}`);
  for (const key of keys) {
    await store.put(key, { title: key });
    await sleep(2);
  }
  await sleep(200);
  const left = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  check(`the directory stops at its cap (${left.length} files)`, left.length <= 5);
  eq('the newest entry survives the sweep', await store.get(keys.at(-1)), {
    title: keys.at(-1),
  });
}

{
  const dir = join(scratch, 'corrupt');
  const store = createCacheStore({ dir, ttlMs: 60_000 });
  await store.put('k', { v: 'seed' });
  const [file] = await jsonFiles(dir);
  const path = join(dir, file);
  const corrupt = [
    ['truncated', '{"key":'],
    ['garbage', 'not json at all'],
    ['zero-byte', ''],
    ['foreign', '{"key":"other","savedAt":1,"value":{}}'],
  ];
  for (const [label, body] of corrupt) {
    await writeFile(path, body);
    let hit;
    try {
      hit = await store.get('k');
    } catch (err) {
      hit = `threw ${err.message}`;
    }
    eq(`a ${label} file reads as a miss`, hit, null);
  }
  await store.put('k', { v: 'recovered' });
  eq('a write recovers a corrupt file', await store.get('k'), {
    v: 'recovered',
  });
}

{
  const dir = join(scratch, 'race');
  const store = createCacheStore({ dir, ttlMs: 60_000 });
  const payload = (n, rows) => ({
    writer: n,
    items: Array.from({ length: rows }, (_, i) => `w${n}-row${i}`),
  });
  const heavy = payload(0, 200_000);
  const last = payload(39, 4);
  await Promise.all([
    store.put('k', heavy),
    ...Array.from({ length: 38 }, (_, n) => store.put('k', payload(n + 1, 4))),
    store.put('k', last),
  ]);
  const left = await readdir(dir);
  eq(
    '40 concurrent puts to one key leave one file',
    left.filter((f) => f.endsWith('.json')).length,
    1,
  );
  eq(
    '40 concurrent puts leave no temp file behind',
    left.filter((f) => !f.endsWith('.json')),
    [],
  );
  let parsed;
  try {
    parsed = JSON.parse(await readFile(join(dir, left[0]), 'utf8'));
  } catch (err) {
    parsed = { unparseable: err.message };
  }
  eq(
    '40 concurrent puts leave a parseable file holding the last write',
    parsed?.value,
    last,
  );
  eq('the raced file reads back through the store', await store.get('k'), last);
}

{
  const envDir = join(scratch, 'env');
  process.env.CFLIX_CACHE_DIR = envDir;
  process.env.CFLIX_CACHE_TTL_MS = '1';
  const store = createCacheStore();
  let refreshed = false;
  await store.put('k', { v: 'env' });
  eq('CFLIX_CACHE_DIR takes the files', (await jsonFiles(envDir)).length, 1);
  await sleep(20);
  eq(
    'CFLIX_CACHE_TTL_MS is honoured',
    await store.get('k', async () => {
      refreshed = true;
      return { v: 'from-env-ttl' };
    }),
    { v: 'env' },
  );
  await sleep(50);
  check('the env TTL drove the background refresh', refreshed);
  eq(
    'the env refresh landed on disk',
    await createCacheStore({ dir: envDir, ttlMs: 60_000 }).get('k'),
    {
      v: 'from-env-ttl',
    },
  );

  // 0 is what an operator setting a TTL of 0 means: cache nothing. It used to mean "always
  // expired", which served the value anyway and so meant cache forever.
  const offDir = join(scratch, 'env-off');
  process.env.CFLIX_CACHE_DIR = offDir;
  process.env.CFLIX_CACHE_TTL_MS = '0';
  const off = createCacheStore();
  await off.put('k', { v: 'never-stored' });
  eq('a TTL of 0 writes no file', await jsonFiles(offDir), []);
  eq('a TTL of 0 serves nothing', await off.get('k'), null);
  delete process.env.CFLIX_CACHE_DIR;
  delete process.env.CFLIX_CACHE_TTL_MS;
}

{
  const status = () =>
    execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO,
      encoding: 'utf8',
    });
  const before = status();
  const key = 'cache-check:default-store';
  await defaultCache.put(key, { v: 1 });
  eq(
    'the default store reads back what it wrote',
    await defaultCache.get(key),
    { v: 1 },
  );
  await defaultCache.invalidate(key);
  eq('the default store invalidates', await defaultCache.get(key), null);
  check('the default store writes nothing into the repo', status() === before);
}

await rm(scratch, { recursive: true, force: true });
console.log(failures ? `${failures} FAIL` : '0 FAIL');
process.exit(failures ? 1 : 0);
