import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ARTIFACTS_DIR = process.env.CFLIX_SHOT_DIR || 'artifacts/verify-cflix';
mkdirSync(ARTIFACTS_DIR, { recursive: true });

let failures = 0;
let passes = 0;
// The page the running suite is driving, so a failure can capture its own evidence.
let activePage = null;
let failureCaptured = false;

export function check(name, cond, detail = '') {
  if (cond) {
    passes++;
    console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? `  ${detail}` : ''}`);
    void captureFailure(name);
  }
}

/** One screenshot per suite, on the first failure. A green run writes nothing. */
async function captureFailure(name) {
  if (failureCaptured || !activePage) return;
  failureCaptured = true;
  await saveScreenshot(activePage, `FAIL-${name.replace(/\W+/g, '-')}`, {
    always: true,
  }).catch((err) =>
    console.error(`[screenshot] failed to capture ${name}: ${err.message}`),
  );
}

export function getStats() {
  return { passes, failures };
}

/**
 * Screenshots are evidence, not assertions: they cost a full-page PNG encode per call and the
 * tall pages here run 2-3s each, so a green run writes none. Set SAVE_SHOTS=1 to capture every
 * checkpoint (needed for a PR, since artifacts/ is tracked), or CFLIX_SHOT_DIR to keep the
 * captures out of the repo. A failure always captures, once per suite, whatever SAVE_SHOTS says.
 */
export async function saveScreenshot(page, name, { always = false } = {}) {
  if (!always && !process.env.SAVE_SHOTS) return null;
  const file = `${name}-${Date.now()}.png`;
  const target = join(ARTIFACTS_DIR, file);
  await page.screenshot({ path: target, fullPage: true });
  console.log(`[screenshot] Saved -> ${target}`);
  return target;
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`);
}

const spawned = new Set();
let handlersInstalled = false;

function killServer(proc) {
  spawned.delete(proc);
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGKILL');
    }
  }, 500);
}

function installExitHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', () => {
    for (const proc of [...spawned]) killServer(proc);
  });
  process.on('SIGINT', () => {
    for (const proc of [...spawned]) killServer(proc);
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    for (const proc of [...spawned]) killServer(proc);
    process.exit(143);
  });
}

// Always an ephemeral server, ignoring BASE or PORT. A caller that needs a second,
// differently-configured instance alongside a shared one uses this, not startServerForRun.
export async function startServer(envOverrides = {}) {
  installExitHandlers();
  const port = await getAvailablePort();
  const baseUrl = `http://localhost:${port}`;
  console.log(`[harness] Spawning ephemeral server on port ${port}...`);
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), ...envOverrides },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  spawned.add(proc);
  await readyServer(baseUrl);
  return { baseUrl, stop: () => killServer(proc) };
}

function externalServerUrl() {
  return (
    process.env.BASE ||
    (process.env.PORT ? `http://localhost:${process.env.PORT}` : null)
  );
}

async function readyServer(baseUrl) {
  await waitForServer(`${baseUrl}/`);
  console.log(`[harness] Server ready at ${baseUrl}. Executing checks...`);
  return baseUrl;
}

// The base URL a check script runs against. Reuses BASE or PORT when set, otherwise spawns an
// ephemeral server that dies with this process, so a script body can stay top-level and still
// never leave a listener behind. It waits for the server here, so an unreachable URL fails
// here by name instead of surfacing later as an obscure page.goto error.
export async function startServerForRun() {
  const external = externalServerUrl();
  return external ? readyServer(external) : (await startServer()).baseUrl;
}

async function withServer(fn) {
  const external = externalServerUrl();
  if (external) return fn(await readyServer(external));
  const server = await startServer();
  try {
    return await fn(server.baseUrl);
  } finally {
    server.stop();
  }
}

export async function runWithServerAndBrowser(fn) {
  await withServer(async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    activePage = page;

    try {
      await fn({ baseUrl, page, context, browser });
    } finally {
      activePage = null;
      await browser.close().catch(() => {});
    }
  });

  console.log(`\nVerification Summary: ${passes} PASS, ${failures} FAIL`);
  if (failures > 0) {
    process.exit(1);
  }
}
