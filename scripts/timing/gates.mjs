/**
 * Wall-clock timings for the two gates, with the load average recorded per run.
 *
 * A single run is not a baseline. The runs are interleaved rather than run in blocks, so a
 * stretch of machine time lands on both gates instead of whichever happened to run second.
 */
import { spawn } from 'node:child_process';
import { load1, summarize } from './stats.mjs';

function runOnce(command, args) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));

    const done = (code, why) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ms, code, out, why });
    };

    // `close`, not `exit`: `exit` fires while stdio is still draining, so the failure
    // output below would lose its tail exactly when someone needs to read it.
    child.on('close', (code) => done(code, null));
    child.on('error', (err) => done(-1, `spawn failed: ${err.message}`));
  });
}

/**
 * @param {{runs?: number}} options `runs` defaults to 5, the smallest count with a median.
 */
export async function measureGates({ runs = 5 } = {}) {
  const gates = [
    { gate: 'npm test', command: 'npm', args: ['test', '--silent'] },
    {
      gate: 'npm run verify',
      command: 'npm',
      args: ['run', 'verify', '--silent'],
    },
  ];

  const collected = gates.map((g) => ({
    ...g,
    samples: [],
    failures: [],
    load: [],
  }));

  for (let i = 0; i < runs; i++) {
    for (const g of collected) {
      const result = await runOnce(g.command, g.args);
      g.samples.push(result.ms);
      g.load.push(load1());
      if (result.code !== 0) {
        g.failures.push(result.code);
        process.stdout.write(
          `  ${g.gate} run ${i + 1} did not pass (${result.why ?? `exit ${result.code}`})\n${result.out.split('\n').slice(-15).join('\n')}\n`,
        );
      }
    }
  }

  return collected.map((g) => ({
    gate: g.gate,
    summary: summarize(g.samples),
    samples: g.samples.map((ms) => Number(ms.toFixed(0))),
    failedRuns: g.failures.length,
    load: g.load,
  }));
}
