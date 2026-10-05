import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const DOC = path.join(ROOT, 'AGENTS.md');

const git = (args) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

const trackedFiles = git(['ls-files']).split('\n').filter(Boolean);
const trackedSet = new Set(trackedFiles);

const CODE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx']);

/** Key names a bullet may cite as behaviour rather than as a symbol. */
const KEY_NAMES = new Set(['F', 'M', 'Space', 'Tab', 'Enter', 'Escape']);

const doc = readFileSync(DOC, 'utf8');

const citedPaths = (span) => {
  const target = span.replace(/:\d+$/, '');
  const extension = path.posix.extname(target).replace(/^\./, '');
  if (!CODE_EXTENSIONS.has(extension)) return null;
  if (trackedSet.has(target)) return target;
  return trackedFiles.find((file) => file.endsWith(`/${target}`)) ?? null;
};

/**
 * A symbol is an identifier-shaped span, or the left-hand side of an assignment such as
 * `EPISODE_ID = /:e\d+$|:\d+:\d+$/`, which is how an agent records a constant. Both must look like
 * code: a leading identifier character and at least one uppercase letter or underscore, so CSS
 * classes, DOM ids, routes and prose words stay out.
 */
const looksLikeSymbol = (span) => {
  if (KEY_NAMES.has(span)) return false;
  const identifier = span.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*=/)?.[1] ?? span;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)) return false;
  return /[A-Z_]/.test(identifier);
};

/**
 * A bullet is the unit, not a line, because a wrapped bullet puts its symbol on one line and the
 * file it belongs to on another. Pairing per bullet is what lets a citation survive rewrapping.
 */
const bullets = doc.split('\n').reduce(
  (groups, line, index) => {
    if (line.startsWith('- ') || line.startsWith('#')) {
      groups.push({ start: index + 1, spans: [] });
    }
    groups[groups.length - 1].spans.push(
      ...[...line.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]),
    );
    return groups;
  },
  [{ start: 1, spans: [] }],
);

const findings = [];
const pairsChecked = new Set();

/**
 * A bullet naming several files has symbols belonging to different ones, so a symbol passes when it
 * lives in at least one file the bullet names. Requiring it in all of them would cross-pair
 * `findSeed` against the adapter that merely shares the sentence.
 */
for (const bullet of bullets) {
  const files = [...new Set(bullet.spans.map(citedPaths).filter(Boolean))];
  const symbols = [...new Set(bullet.spans.filter(looksLikeSymbol))];
  if (files.length === 0 || symbols.length === 0) continue;

  const contents = files.map((file) => [file, git(['show', `HEAD:${file}`])]);

  for (const symbol of symbols) {
    if (pairsChecked.has(symbol)) continue;
    pairsChecked.add(symbol);
    const pattern = new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\b`);
    if (!contents.some(([, text]) => pattern.test(text))) {
      findings.push({ line: bullet.start, symbol, files: files.join(', ') });
    }
  }
}

console.log(
  `agents-symbols-check: ${pairsChecked.size} symbol citations in bullets that name a source file, ${findings.length} name a symbol no named file contains`,
);

if (findings.length === 0) {
  console.log('PASS  every cited symbol exists in a file its bullet names');
  process.exit(0);
}

for (const finding of findings) {
  console.log(
    `FAIL  AGENTS.md:${finding.line} cites \`${finding.symbol}\`, which is in none of ${finding.files}`,
  );
  console.log(
    `      The symbol was renamed or deleted, so this rule describes code that no longer exists. Cite the current name.`,
  );
}
process.exit(1);
