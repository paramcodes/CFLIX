import { readFileSync } from 'node:fs';
import { movies, series } from '../server/src/catalog-data.js';

/**
 * Condition 3 of the arch-audit program: the offline fixture must carry every key
 * `contract.js` declares for CatalogItem and Episode, hold no duplicate id, and namespace
 * every id with `seed:`. The key list is parsed out of the contract typedefs at run time so
 * the contract stays the only place a key can be declared.
 */

const CONTRACT_URL = new URL(
  '../server/src/providers/contract.js',
  import.meta.url,
);
const NAMESPACE = 'seed:';

const clean = (text) =>
  text
    .split('\n')
    .map((line) => line.replace(/^\s*\*+ ?/, ''))
    .join('\n');

function readBraced(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return [text.slice(from + 1, i), i + 1];
    }
  }
  return [null, from];
}

function parseContract(source) {
  const typedefs = new Map();
  for (const chunk of clean(source).split('@typedef').slice(1)) {
    const open = chunk.indexOf('{');
    if (open < 0) continue;
    const [rawType, afterType] = readBraced(chunk, open);
    if (rawType === null) continue;
    const name = chunk.slice(afterType).match(/^[\s*]*([A-Za-z]\w*)/)?.[1];
    if (!name) continue;

    const props = new Map();
    for (const line of chunk.split('\n')) {
      const at = line.indexOf('@property');
      if (at < 0) continue;
      const rest = line.slice(at + '@property'.length).trim();
      if (!rest.startsWith('{')) continue;
      const [rawPropType, afterPropType] = readBraced(rest, 0);
      const propName = rest.slice(afterPropType).trim().split(/\s+/)[0];
      if (rawPropType === null || !propName) continue;
      props.set(propName, rawPropType.trim());
    }

    const amp = rawType.indexOf('&');
    if (amp >= 0) {
      const [body] = readBraced(rawType, rawType.indexOf('{', amp));
      for (const match of body.matchAll(/(\w+)\s*:\s*([^,\n}]+)/g)) {
        props.set(match[1], match[2].trim());
      }
    }
    typedefs.set(name, { type: rawType.trim(), props });
  }
  return typedefs;
}

const contract = parseContract(readFileSync(CONTRACT_URL, 'utf8'));
const variantKeys = (name) => {
  const merged = new Map(contract.get('CatalogItemBase')?.props ?? new Map());
  for (const [key, type] of contract.get(name)?.props ?? new Map()) {
    merged.set(key, type);
  }
  return merged;
};
const movieKeys = variantKeys('MovieItem');
const seriesKeys = variantKeys('SeriesItem');
const episodeKeys = contract.get('Episode')?.props ?? new Map();

const check = (ok, message) => {
  if (!ok) {
    console.error(`fixture-conformance: ${message}`);
    process.exit(1);
  }
};

check(
  movieKeys.size > 0 && episodeKeys.size > 0,
  'parsed no keys out of contract.js, so nothing is being checked',
);
for (const key of ['id', 'title', 'posterUrl', 'maturity', 'provider']) {
  check(
    movieKeys.has(key),
    `CatalogItemBase no longer declares ${key}; update this check`,
  );
}
for (const key of ['seasonCount', 'episodes']) {
  check(
    seriesKeys.has(key),
    `SeriesItem no longer declares ${key}; update this check`,
  );
}
for (const key of ['seriesId', 'stillUrl']) {
  check(
    episodeKeys.has(key),
    `Episode no longer declares ${key}; update this check`,
  );
}

const failures = { keys: [], duplicates: [], namespace: [] };
const fail = (group, message) => failures[group].push(message);

function typeProblem(type, value) {
  const nullable = /\bnull\b/.test(type);
  if (value === null || value === undefined) {
    return nullable ? null : `required ${type}, got ${value}`;
  }
  const base = type
    .replace(/\|\s*null/g, '')
    .replace(/\s*\|\s*undefined/g, '')
    .trim();
  if (base.startsWith("'")) {
    const options = base
      .split('|')
      .map((option) => option.trim().replace(/^'|'$/g, ''));
    return options.includes(value)
      ? null
      : `expected one of ${base}, got ${value}`;
  }
  if (base === 'string') {
    return typeof value === 'string'
      ? null
      : `expected string, got ${typeof value}`;
  }
  if (base === 'number') {
    return typeof value === 'number'
      ? null
      : `expected number, got ${typeof value}`;
  }
  if (base.endsWith('[]')) {
    return Array.isArray(value)
      ? null
      : `expected an array, got ${typeof value}`;
  }
  const named = contract.get(base);
  return named ? typeProblem(named.type, value) : null;
}

function checkRecord(path, node, keys) {
  for (const [key, type] of keys) {
    if (!(key in node)) {
      fail('keys', `${path}: missing ${key} (${type})`);
      continue;
    }
    const problem = typeProblem(type, node[key]);
    if (problem) fail('keys', `${path}.${key}: ${problem}`);
  }
  for (const key of Object.keys(node)) {
    if (!keys.has(key)) fail('keys', `${path}: ${key} is not in the contract`);
  }
}

function* episodesIn(node, path) {
  if (Array.isArray(node)) {
    for (const [i, value] of node.entries())
      yield* episodesIn(value, `${path}[${i}]`);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if ('seriesId' in node && 'seasonNumber' in node) {
    yield [path, node];
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'episodes' || key === 'seasons') {
      yield* episodesIn(value, `${path}.${key}`);
    }
  }
}

const items = [
  ...movies.map((item, i) => [`movies[${i}]`, item, movieKeys]),
  ...series.map((item, i) => [`series[${i}]`, item, seriesKeys]),
];
const episodes = [
  ...series.flatMap((item, i) => [...episodesIn(item, `series[${i}]`)]),
];

check(
  movies.length > 0,
  'the fixture declares no movies, so there is nothing to check',
);
check(
  series.length > 0,
  'the fixture declares no series, so there is nothing to check',
);
check(
  episodes.length > 0,
  'the fixture declares no episodes, so there is nothing to check',
);

for (const [path, node, keys] of items) checkRecord(path, node, keys);
for (const [path, node] of episodes) checkRecord(path, node, episodeKeys);

const seen = new Map();
for (const [path, node] of [...items.map(([p, n]) => [p, n]), ...episodes]) {
  const at = seen.get(node.id) ?? [];
  at.push(path);
  seen.set(node.id, at);
}
check(seen.size > 0, 'no fixture id was found, so nothing is being checked');

for (const [id, at] of seen) {
  if (at.length > 1) {
    fail('duplicates', `${id} is minted ${at.length} times: ${at.join(', ')}`);
  }
}
const bare = [...seen.keys()].filter((id) => !String(id).startsWith(NAMESPACE));
if (bare.length) {
  fail(
    'namespace',
    `${bare.length} of ${seen.size} fixture ids lack "${NAMESPACE}": ${bare.join(', ')}`,
  );
}

const total = Object.values(failures).reduce((n, list) => n + list.length, 0);
const conditions = Object.values(failures).filter((list) => list.length).length;
if (total) {
  for (const [group, list] of Object.entries(failures)) {
    if (!list.length) continue;
    console.error(`fixture-conformance  ${group}: ${list.length} problem(s)`);
    for (const message of list) console.error(`  ${message}`);
  }
  console.error(
    `fixture-conformance  FAIL, ${total} problems in ${conditions} of 3 conditions`,
  );
  process.exit(1);
}
console.log(
  `fixture-conformance  PASS, ${items.length} items, ${episodes.length} episodes, ${seen.size} ids, 3 conditions`,
);
