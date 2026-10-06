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

/**
 * Prefixes every line a suite writes with its name. The suites run concurrently, so untagged
 * output interleaves and a FAIL cannot be attributed to the suite that produced it.
 */
function tagOutput(stream, label, write) {
  let buffered = '';
  stream.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) write(`${label} | ${line}`);
  });
  stream.on('end', () => {
    if (buffered) write(`${label} | ${buffered}`);
  });
}

function runSuite(suite, port) {
  const started = Date.now();
  const label = suite.name.padEnd(16);
  console.log(`>>> Starting Suite: ${suite.name} (${suite.script})`);

  const child = spawn(process.execPath, [suite.script], {
    env: {
      ...process.env,
      PORT: String(port),
      BASE: `http://localhost:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  tagOutput(child.stdout, label, (line) => console.log(line));
  tagOutput(child.stderr, label, (line) => console.error(line));

  return new Promise((resolve) => {
    child.on('exit', (code) =>
      resolve({ suite, code: code ?? 1, ms: Date.now() - started }),
    );
  });
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

    // Concurrent, because the suites are independent: each signs up its own account under a
    // distinct email prefix and writes only its own state, and they already shared this one
    // server. Serial cost was the sum of four independent bodies; concurrent cost is the
    // slowest one. Durations are reported because a suite's own output cannot say what it cost.
    const results = await Promise.all(
      suites.map((suite) => runSuite(suite, port)),
    );

    console.log(`\n=== Suite durations ===`);
    for (const { suite, code, ms } of results.sort((a, b) => b.ms - a.ms)) {
      console.log(`  ${(ms / 1000).toFixed(1)}s  ${suite.name}  exit=${code}`);
    }

    for (const { suite, code } of results) {
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
