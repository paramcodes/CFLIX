import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ARTIFACTS_DIR = 'artifacts/verify-cflix';
mkdirSync(ARTIFACTS_DIR, { recursive: true });

let failures = 0;
let passes = 0;

export function check(name, cond, detail = '') {
  if (cond) {
    passes++;
    console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  }
}

export function getStats() {
  return { passes, failures };
}

export async function saveScreenshot(page, name) {
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

export async function runWithServerAndBrowser(fn) {
  let serverProc = null;
  let baseUrl =
    process.env.BASE ||
    (process.env.PORT ? `http://localhost:${process.env.PORT}` : null);

  if (!baseUrl) {
    const port = await getAvailablePort();
    baseUrl = `http://localhost:${port}`;
    console.log(`[harness] Spawning ephemeral server on port ${port}...`);
    serverProc = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const killServer = () => {
      if (serverProc && !serverProc.killed) {
        serverProc.kill('SIGTERM');
        setTimeout(() => {
          if (serverProc && !serverProc.killed) serverProc.kill('SIGKILL');
        }, 500);
      }
    };

    process.on('SIGINT', () => {
      killServer();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      killServer();
      process.exit(143);
    });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await waitForServer(`${baseUrl}/`);
    console.log(`[harness] Server ready at ${baseUrl}. Executing checks...`);
    await fn({ baseUrl, page, context, browser });
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) {
      serverProc.kill('SIGTERM');
    }
  }

  console.log(`\nVerification Summary: ${passes} PASS, ${failures} FAIL`);
  if (failures > 0) {
    process.exit(1);
  }
}
