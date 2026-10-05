import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const DOC = path.join(ROOT, 'AGENTS.md');

const gitLines = (args) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).split('\n');

/** Whether git's ignore rules swallow this path, judged from the rules alone so a fresh clone agrees. */
const isGitIgnored = (relPath) => {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', relPath], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

const trackedFiles = gitLines(['ls-files']).filter(Boolean);

const trackedPaths = new Set(trackedFiles);
for (const file of trackedFiles) {
  let dir = path.posix.dirname(file);
  while (dir && dir !== '.' && !trackedPaths.has(dir)) {
    trackedPaths.add(dir);
    dir = path.posix.dirname(dir);
  }
}

/** Extensions the repo actually ships, so `state.current` and `data.session.token` stay prose. */
const trackedExtensions = new Set(
  trackedFiles
    .map((file) => path.posix.extname(file).replace(/^\./, ''))
    .filter(Boolean),
);

const ignoreLines = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));

/** Directories `.gitignore` excludes wholesale, so a bare basename can be placed under one. */
const ignoredDirRoots = ignoreLines
  .filter((line) => line.endsWith('/'))
  .map((line) => line.replace(/\/$/, ''));

/** An untracked name cited to describe an ignore rule resolves against `.gitignore` itself. */
const ignorePatterns = ignoreLines.filter((line) => !line.endsWith('/'));

const isGlob = (value) => /[*?]/.test(value);

const escapeForRegExp = (value) => value.replace(/[.+^${}()|[\]\\]/g, '\\$&');

const globToRegExp = (glob) =>
  new RegExp(
    '^' +
      glob
        .split('/')
        .map((segment) =>
          escapeForRegExp(segment)
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]'),
        )
        .join('/') +
      '$',
  );

/**
 * A citation resolves against the tracked tree, never the working tree, so the verdict is identical
 * in a fresh clone, in a sibling worktree, and after a local branch is pruned. A citation written
 * relative to the directory its sentence is about resolves by suffix, which is how `css/player.css`
 * and `features/` reach their real paths.
 */
function resolve(citation) {
  const target = citation.replace(/:\d+$/, '').replace(/\/$/, '');

  if (isGlob(target)) {
    const anchored = new RegExp(`${globToRegExp(target).source.slice(1, -1)}$`);
    if ([...trackedPaths].some((candidate) => anchored.test(`/${candidate}`))) {
      return true;
    }
    return ignorePatterns.some((pattern) => globToRegExp(pattern).test(target));
  }

  if (trackedPaths.has(target)) return true;

  if (target.includes('/')) {
    return [...trackedPaths].some(
      (candidate) =>
        candidate.endsWith(`/${target}`) || candidate.startsWith(`${target}/`),
    );
  }

  return [...trackedPaths].some(
    (candidate) => path.posix.basename(candidate) === target,
  );
}

/**
 * The ignore rule that already swallowed this citation. A citation written as a bare basename names
 * its directory only in surrounding prose, so an ignored directory root is tried as a parent too,
 * which is what separates `scroll-probe.mjs` the dead gitignored probe from a plain typo.
 */
const ignoredBy = (citation) => {
  const target = citation.replace(/:\d+$/, '').replace(/\/$/, '');
  const segments = target.split('/');
  const prefixes = segments.map((_, cut) =>
    segments.slice(0, cut + 1).join('/'),
  );
  const parented = target.includes('/')
    ? prefixes
    : [...prefixes, ...ignoredDirRoots.map((root) => `${root}/${target}`)];
  return parented.find((prefix) => isGitIgnored(`${prefix}/`)) ?? null;
};

/**
 * A citation is a span shaped like a path this repo ships: a glob, a directory, a tracked
 * extension, or a path already tracked. Everything else is prose — a CSS class, a DOM or session
 * key, a git ref, or an API route — and stays out of the report so the failures that do print are
 * all real. Git's own metadata under `.git/` is not repo content.
 */
function isPathCitation(span) {
  if (span !== span.trim()) return false;
  if (/\s/.test(span)) return false;
  if (span.includes('://')) return false;
  if (span.includes('..')) return false;
  if (/^[/#?~]/.test(span)) return false;
  if (/[=()[\]<>"']/.test(span)) return false;
  if (span.startsWith('.git/')) return false;

  const target = span.replace(/:\d+$/, '');
  if (isGlob(target)) return true;
  if (target.endsWith('/')) return true;
  if (trackedPaths.has(target.replace(/\/$/, ''))) return true;

  const extension = path.posix.extname(target).replace(/^\./, '');
  return Boolean(extension) && trackedExtensions.has(extension);
}

const doc = readFileSync(DOC, 'utf8');
const spans = [...doc.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
const candidates = [...new Set(spans.filter(isPathCitation))];

const findings = [];
for (const citation of candidates) {
  if (resolve(citation)) continue;
  const swallowedBy = ignoredBy(citation);
  findings.push({
    citation,
    kind: swallowedBy ? 'gitignored' : 'unresolved',
    swallowedBy,
  });
}

console.log(
  `agents-paths-check: ${candidates.length} repo path citations in AGENTS.md, ${findings.length} do not resolve`,
);

if (findings.length === 0) {
  console.log('PASS  every cited repo path resolves to a tracked file');
  process.exit(0);
}

for (const finding of findings) {
  console.log(`FAIL  ${finding.citation} [${finding.kind}]`);
  console.log(
    finding.kind === 'gitignored'
      ? `      "${finding.swallowedBy}" is gitignored, so this citation is dead on every fresh clone and every sibling worktree. Cite the tracked file that enforces the rule instead.`
      : `      no tracked file or directory ends in this path. Fix the citation or delete the rule.`,
  );
}
process.exit(1);
