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

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitReady(baseUrl, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.status === 200) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server at ${baseUrl} was not ready within ${timeoutMs}ms`);
}

/**
 * @returns {Promise<{baseUrl: string, cacheDir: string, clearCache: () => Promise<void>, stop: () => Promise<void>}>}
 */
export async function bootServer({ env = {} } = {}) {
  const port = await freePort();
  const cacheDir = mkdtempSync(join(tmpdir(), 'cflix-timing-'));
  const baseUrl = `http://127.0.0.1:${port}`;

  const proc = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      CFLIX_CACHE_DIR: cacheDir,
      ...env,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  await waitReady(baseUrl);

  return {
    baseUrl,
    cacheDir,
    clearCache() {
      rmSync(cacheDir, { recursive: true, force: true });
    },
    stop() {
      if (proc.exitCode === null) proc.kill('SIGTERM');
      rmSync(cacheDir, { recursive: true, force: true });
    },
  };
}

/** A signup plus one adult profile: every catalog route needs both a token and a profile id. */
export async function signIn(baseUrl) {
  const email = `timing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.dev`;
  const auth = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw123456' }),
  }).then((r) => r.json());

  const profile = await fetch(`${baseUrl}/api/profiles`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.session.token}`,
    },
    body: JSON.stringify({ name: 'Timing', maturity: 'adult' }),
  }).then((r) => r.json());

  return { token: auth.session.token, profile };
}

/**
 * One timed request. Returns the status and the item count alongside the duration so a
 * failed or empty response cannot pass as a fast one.
 */
export async function timed({
  baseUrl,
  method = 'GET',
  path,
  body,
  token,
  profileId,
}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (profileId) headers['x-cflix-profile'] = profileId;

  const started = process.hrtime.bigint();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  const items = Array.isArray(data.items) ? data.items : null;
  return {
    ms,
    status: res.status,
    items: items ? items.length : null,
    sources: items ? [...new Set(items.map((i) => i?.source))] : null,
  };
}
