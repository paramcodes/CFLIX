import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const suites = [
  { name: 'Auth & Signin', script: 'scripts/verify/verify-auth.mjs' },
  { name: 'Profiles', script: 'scripts/verify/verify-profiles.mjs' },
  { name: 'Browse & Search', script: 'scripts/verify/verify-browse.mjs' },
  { name: 'Playback & Detail', script: 'scripts/verify/verify-playback.mjs' },
];

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

async function waitForServer(port, timeoutMs = 6000) {
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
  console.log(`====================================================`);
  console.log(
    `[verify-all] Starting master verification suite on port ${port}...`,
  );
  console.log(`====================================================\n`);

  const serverProc = spawn(process.execPath, ['server/index.js'], {
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

  let totalFailures = 0;

  try {
    await waitForServer(port);

    for (const suite of suites) {
      console.log(`\n>>> Running Suite: ${suite.name} (${suite.script})`);
      const child = spawn(process.execPath, [suite.script], {
        env: {
          ...process.env,
          PORT: String(port),
          BASE: `http://localhost:${port}`,
        },
        stdio: 'inherit',
      });

      const code = await new Promise((resolve) => {
        child.on('exit', (c) => resolve(c ?? 1));
      });

      if (code !== 0) {
        totalFailures++;
        console.error(
          `[verify-all] Suite ${suite.name} failed with exit code ${code}`,
        );
      }
    }
  } finally {
    killServer();
  }

  console.log(`\n====================================================`);
  if (totalFailures === 0) {
    console.log(`[verify-all] ALL 4 VERIFICATION SUITES PASSED CLEANLY! 🎉`);
    console.log(`====================================================\n`);
    process.exit(0);
  } else {
    console.error(`[verify-all] ${totalFailures} suites failed!`);
    console.log(`====================================================\n`);
    process.exit(1);
  }
}

main();
