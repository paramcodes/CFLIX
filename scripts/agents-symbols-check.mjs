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
let checked = 0;

/**
 * Cited files are read from the working tree, not from `git show HEAD:`, because `npm test` runs
 * against the working tree. Reading HEAD would let an author rename a symbol without committing and
 * still get a green gate, and would fail an author who cites a symbol they just added but have not
 * committed yet. In CI the checkout is clean, so both agree and the behaviour is identical there.
 * A tracked file that cannot be read from disk is reported as a finding rather than thrown, since a
 * deleted-but-tracked file is exactly the drift this check exists to catch.
 *
 * Each bullet is checked independently. A symbol cited in two bullets, once correctly and once
 * against a file that lacks it, must flag the wrong one, so there is deliberately no dedupe across
 * bullets: `new Set` above already removes repeats within a bullet.
 */
for (const bullet of bullets) {
  const files = [...new Set(bullet.spans.map(citedPaths).filter(Boolean))];
  const symbols = [...new Set(bullet.spans.filter(looksLikeSymbol))];
  if (files.length === 0 || symbols.length === 0) continue;

  const contents = files.map((file) => {
    try {
      return [file, readFileSync(path.join(ROOT, file), 'utf8')];
    } catch {
      findings.push({ line: bullet.start, unreadable: file });
      return null;
    }
  });
  const readable = contents.filter(Boolean);
  if (readable.length === 0) continue;

  for (const symbol of symbols) {
    checked++;
    const pattern = new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\b`);
    if (!readable.some(([, text]) => pattern.test(text))) {
      findings.push({
        line: bullet.start,
        symbol,
        files: readable.map(([file]) => file).join(', '),
      });
    }
  }
}

console.log(
  `agents-symbols-check: ${checked} symbol citations checked against the working tree, ${findings.length} name a symbol no cited file contains`,
);

if (findings.length === 0) {
  console.log(
    'PASS  every cited symbol exists in a cited file its bullet names',
  );
  process.exit(0);
}

for (const finding of findings) {
  if (finding.unreadable) {
    console.log(
      `FAIL  AGENTS.md:${finding.line} cites ${finding.unreadable}, which is tracked but unreadable in the working tree`,
    );
    console.log(
      `      A file deleted but not staged is the same drift as a deleted symbol. Restore it, or unstage the deletion.`,
    );
    continue;
  }
  console.log(
    `FAIL  AGENTS.md:${finding.line} cites \`${finding.symbol}\`, which is in none of ${finding.files}`,
  );
  console.log(
    `      The symbol was renamed or deleted, so this rule describes code that no longer exists. Cite the current name.`,
  );
}
process.exit(1);
