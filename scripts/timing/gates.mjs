/**
 * Wall-clock timings for the two gates, plus the load average at the moment of measurement.
 *
 * A single run is not a baseline. `runs` defaults to 5, the point at which a median means
 * something, and the two gates are interleaved rather than run in blocks so a slow patch of
 * machine time lands on both instead of whichever happened to run second.
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
    child.on('exit', (code) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ms, code, out });
    });
  });
}

/**
 * @param {{runs?: number}} options `runs` defaults to 5.
 * @returns {Promise<Array<{gate: string, samples: number[], summary: object, failures: number, runFailures: number[], load: number[]}>>}
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
    runFailures: [],
    load: [],
  }));

  // Interleaved: test, verify, test, verify, ...
  for (let i = 0; i < runs; i++) {
    for (const g of collected) {
      const result = await runOnce(g.command, g.args);
      g.samples.push(result.ms);
      g.load.push(load1());
      if (result.code !== 0) {
        g.runFailures.push(result.code);
        process.stdout.write(
          `  ${g.gate} run ${i + 1} exited ${result.code}\n`,
        );
        process.stdout.write(
          `${result.out.split('\n').slice(-15).join('\n')}\n`,
        );
      }
    }
  }

  return collected.map((g) => ({
    gate: g.gate,
    samples: g.samples.map((ms) => Number(ms.toFixed(0))),
    summary: summarize(g.samples),
    failures: g.runFailures.length,
    runFailures: g.runFailures,
    load: g.load,
  }));
}
