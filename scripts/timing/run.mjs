/**
 * The timing baseline. One entry point, three measurements, a JSON artifact.
 *
 * Usage:
 *   node scripts/timing/run.mjs                  # every phase
 *   node scripts/timing/run.mjs gates api        # a subset
 *   node scripts/timing/run.mjs --runs 9         # gate runs and page loads
 *   node scripts/timing/run.mjs --out path.json
 *
 * The exit code is 0 whenever the harness measured what it was asked to measure. A gate that
 * fails while being timed is a result, not a harness failure, and the run summary says which.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { machine } from './stats.mjs';
import { measureGates } from './gates.mjs';
import { measureApi } from './api.mjs';
import { measurePages } from './pages.mjs';

const PHASES = ['gates', 'api', 'pages'];

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} needs a value`);
  }
  return value;
}

/** A sample count that is not a positive integer would silently produce an empty baseline. */
function count(name, fallback) {
  const n = Number(flag(name, fallback));
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `--${name} must be a positive integer, got ${flag(name, fallback)}`,
    );
  }
  return n;
}

const chosen = args.filter((a) => PHASES.includes(a));
const phases = chosen.length ? chosen : PHASES;

const runs = count('runs', 5);
const coldRuns = count('cold-runs', 5);
const warmRuns = count('warm-runs', 20);
const out = flag('out', 'artifacts/timings/baseline.json');

const report = {
  startedAt: new Date().toISOString(),
  head: execSync('git rev-parse HEAD').toString().trim(),
  dirty: Number(
    execSync('git status --porcelain').toString().split('\n').filter(Boolean)
      .length,
  ),
  machine: machine(),
  config: { phases, runs, coldRuns, warmRuns },
};

process.stdout.write(
  `# timing baseline\nhead ${report.head}, ${report.dirty} untracked or modified paths\ncores ${report.machine.cores}, load1 ${report.machine.load1}\n\n`,
);

if (phases.includes('gates')) {
  process.stdout.write('## gates\n');
  report.gates = await measureGates({ runs });
  for (const g of report.gates) {
    process.stdout.write(
      `  ${g.gate}: median ${g.summary.median} ms, range ${g.summary.min}-${g.summary.max} ms (n=${g.summary.n}, ${g.failedRuns} failed runs, load1 per run ${g.load.join(', ')})\n`,
    );
  }
  process.stdout.write('\n');
}

if (phases.includes('api')) {
  process.stdout.write('## server responses\n');
  report.api = await measureApi({ coldRuns, warmRuns });
  process.stdout.write('\n');
}

if (phases.includes('pages')) {
  process.stdout.write('## page loads\n');
  report.pages = await measurePages({ runs });
  process.stdout.write('\n');
}

report.machineAtEnd = machine();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `wrote ${out}\nphases measured: ${phases.join(', ')}\ncores ${report.machineAtEnd.cores}, load1 at end ${report.machineAtEnd.load1}\n`,
);
