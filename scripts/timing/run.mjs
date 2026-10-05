/**
 * The timing baseline. One entry point, three measurements, a JSON artifact.
 *
 * Usage:
 *   node scripts/timing/run.mjs                # everything
 *   node scripts/timing/run.mjs gates api      # a subset
 *   node scripts/timing/run.mjs --runs 9       # more gate runs, more page loads
 *   node scripts/timing/run.mjs --out path.json
 *
 * Exit code is 0 whenever the harness ran to completion, even if a measured gate failed.
 * A measurement failing is a result, not a harness bug, and this file must not be usable
 * as a gate that blocks a commit on someone else's slow network.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { machine } from './stats.mjs';
import { measureGates } from './gates.mjs';
import { measureApi } from './api.mjs';
import { measurePages } from './pages.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const ALL = ['gates', 'api', 'pages'];
const selected = args.filter((a) => ALL.includes(a));
const phases = selected.length ? selected : ALL;

const runs = Number(flag('runs', 5));
const coldRuns = Number(flag('cold-runs', 5));
const warmRuns = Number(flag('warm-runs', 20));
const out = flag('out', 'artifacts/timings/baseline.json');

const head = execSync('git rev-parse HEAD').toString().trim();
const startedAt = new Date().toISOString();
const env = machine();

const report = {
  startedAt,
  head,
  machine: env,
  config: { runs, coldRuns, warmRuns },
};

process.stdout.write(
  `# timing baseline\nhead ${head}\ncores ${env.cores}, load1 ${env.load1}\n\n`,
);

if (phases.includes('gates')) {
  process.stdout.write('## gates\n');
  report.gates = await measureGates({ runs });
  for (const g of report.gates) {
    process.stdout.write(
      `  ${g.gate}: median ${g.summary.median} ms, range ${g.summary.min}-${g.summary.max} ms (n=${g.summary.n}, ${g.failures} failed runs, load1 per run ${g.load.join(', ')})\n`,
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
  `wrote ${out}\ncores ${report.machineAtEnd.cores}, load1 at end ${report.machineAtEnd.load1}\n`,
);
