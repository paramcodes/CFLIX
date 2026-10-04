import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

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

async function waitForServer(port, timeoutMs = 5000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${port}/`;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Server failed to start on port ${port} within ${timeoutMs}ms`,
  );
}

async function main() {
  const port = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : await getAvailablePort();
  console.log(`[test-runner] Spawning server on port ${port}...`);

  const serverProc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  let serverExited = false;
  serverProc.on('exit', (code) => {
    serverExited = true;
    if (code !== 0 && code !== null) {
      console.error(
        `[test-runner] Server exited unexpectedly with code ${code}`,
      );
    }
  });

  const killServer = () => {
    if (!serverExited) {
      serverProc.kill('SIGTERM');
      setTimeout(() => {
        if (!serverExited) serverProc.kill('SIGKILL');
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

  try {
    await waitForServer(port);
    console.log(`[test-runner] Server ready. Running scripts/smoke.mjs...`);

    const smokeProc = spawn(process.execPath, ['scripts/smoke.mjs'], {
      env: { ...process.env, PORT: String(port) },
      stdio: 'inherit',
    });

    const exitCode = await new Promise((resolve) => {
      smokeProc.on('exit', (code) => resolve(code ?? 1));
    });

    killServer();
    process.exit(exitCode);
  } catch (err) {
    console.error(`[test-runner] Error:`, err.message);
    killServer();
    process.exit(1);
  }
}

main();
