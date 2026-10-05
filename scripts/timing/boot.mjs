/**
 * An ephemeral server on a free port, with a cache directory this harness owns.
 *
 * The cache directory is the cold/warm lever: every provider read goes through
 * `throughCache`, which misses when the file is absent, so emptying the directory between
 * samples is what makes a sample cold.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Waits for the child's own startup line, not for anything answering on the port.
 *
 * The port is free at the instant it is read and can be taken by the next process to ask,
 * and this harness runs on a box where sibling agents boot servers constantly. Polling
 * `GET /` would accept a stranger's 200 and every sample after it would be someone else's
 * server. `server/index.js` prints `cflix on http://localhost:<port>` from its listen
 * callback, so that line identifies the child.
 */
async function waitForOwnServer(proc, port, timeoutMs = 10000) {
  const banner = `cflix on http://localhost:${port}`;

  return new Promise((resolve, reject) => {
    let seen = '';
    let stderr = '';

    const fail = (why) =>
      reject(
        new Error(
          `server on port ${port} never announced itself: ${why}\nstderr:\n${stderr.slice(-2000)}`,
        ),
      );

    proc.stdout.on('data', (d) => {
      seen += d;
      if (seen.includes(banner)) resolve();
    });
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', (err) => fail(`spawn failed: ${err.message}`));
    proc.on('exit', (code, signal) =>
      fail(`child exited early with code ${code} signal ${signal}`),
    );

    setTimeout(() => {
      proc.stdout.removeAllListeners('data');
      fail(`no "${banner}" within ${timeoutMs}ms`);
    }, timeoutMs).unref();
  });
}

/** @returns {Promise<{baseUrl: string, clearCache: () => void, stop: () => void}>} */
export async function bootServer() {
  const port = await freePort();
  const cacheDir = mkdtempSync(join(tmpdir(), 'cflix-timing-'));
  const baseUrl = `http://127.0.0.1:${port}`;

  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), CFLIX_CACHE_DIR: cacheDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForOwnServer(proc, port);

  return {
    baseUrl,
    clearCache: () => rmSync(cacheDir, { recursive: true, force: true }),
    stop: () => {
      if (proc.exitCode === null) proc.kill('SIGTERM');
      rmSync(cacheDir, { recursive: true, force: true });
    },
  };
}

/**
 * An authenticated catalog client, and the live id every dynamic route needs.
 *
 * The id is read from a live browse rather than pinned here: a fixed Cinemeta id rots, and a
 * request for an id that no longer exists answers 404 fast enough to look like the fastest
 * endpoint in the table. A missing id therefore throws instead of being measured.
 *
 * @returns {Promise<{baseUrl: string, headers: object, liveId: string}>}
 */
export async function timingClient() {
  const server = await bootServer();
  const email = `timing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.dev`;

  const auth = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw123456' }),
  }).then((r) => r.json());

  const profile = await fetch(`${server.baseUrl}/api/profiles`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.session.token}`,
    },
    body: JSON.stringify({ name: 'Timing', maturity: 'adult' }),
  }).then((r) => r.json());

  const headers = {
    authorization: `Bearer ${auth.session.token}`,
    'x-cflix-profile': profile.id,
  };

  const catalog = await fetch(
    `${server.baseUrl}/api/catalog/browse?kind=movie`,
    { headers },
  ).then((r) => r.json());
  const liveId = catalog.items?.[0]?.id;

  if (!liveId) {
    await server.stop();
    throw new Error(
      'no live catalog item to measure against; browse?kind=movie returned no items',
    );
  }

  return { ...server, headers, liveId };
}

/**
 * One timed request. Reports the status and the payload shape next to the duration, because a
 * rejected or empty response is fast in a way a real one never is.
 */
export async function timed({
  baseUrl,
  headers,
  method = 'GET',
  path,
  body,
  expectSource,
}) {
  const started = process.hrtime.bigint();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  const items = Array.isArray(data.items) ? data.items : null;
  const sources = items
    ? [...new Set(items.map((i) => i?.source))]
    : data.source
      ? [data.source]
      : null;

  if (expectSource && !sources?.includes(expectSource)) {
    throw new Error(
      `${path} answered with sources ${JSON.stringify(sources)}, expected ${expectSource}. The number for this route would not be the path it claims to measure.`,
    );
  }

  return {
    ms,
    status: res.status,
    itemCount: items ? items.length : data.title ? 1 : 0,
    sources,
  };
}
