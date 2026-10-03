import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { movies, series } from '../src/catalog-data.js';

const MAGICK = 'magick';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, process.argv[2] ?? 'public/poster.png');
const OUT_DIR = join(ROOT, 'public/posters');
const COLS = 12;
const ROWS = 15;
const TILES = {
  m1: [7, 5], m2: [0, 5], m3: [11, 5], m4: [0, 6], s1: [5, 1], s2: [7, 7],
};

const fail = (msg) => {
  console.error(`posters: ${msg}`);
  process.exit(1);
};

function run(bin, args, input) {
  try {
    return execFileSync(bin, args, { input, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    fail(`${bin} ${args.join(' ')}: ${e.message}`);
  }
}

// Projection averages a full row or column, so only the black gutters land near black.
function profile(resize) {
  const raw = run(MAGICK, [SRC, '-colorspace', 'Gray', '-resize', resize, '-depth', '8', 'gray:-']);
  const text = run('od', ['-An', '-v', '-tu1', '-w1'], raw);
  return text.toString('ascii').split(/\s+/).filter(Boolean).map(Number);
}

function darkRuns(values) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const dark = i < values.length && values[i] <= 8;
    if (dark && start < 0) start = i;
    if (!dark && start >= 0) {
      if (i - start >= 4) runs.push([start, i]);
      start = -1;
    }
  }
  return runs;
}

function tileBoxes(values) {
  const boxes = [];
  let prev = 0;
  for (const [start, end] of darkRuns(values)) {
    if (start > prev) boxes.push([prev, start]);
    prev = end;
  }
  if (prev < values.length) boxes.push([prev, values.length]);
  return boxes;
}

const cols = tileBoxes(profile('x1!'));
const rows = tileBoxes(profile('1x!'));
if (cols.length !== COLS) fail(`expected ${COLS} columns in ${SRC}, detected ${cols.length}`);
if (rows.length !== ROWS) fail(`expected ${ROWS} rows in ${SRC}, detected ${rows.length}`);

const catalog = [...movies, ...series];
const ids = new Set(catalog.map((item) => item.id));
for (const id of Object.keys(TILES)) {
  if (!ids.has(id)) fail(`tile table lists "${id}", which is not in the catalog`);
}
for (const item of catalog) {
  if (!TILES[item.id]) fail(`catalog item "${item.id}" has no tile entry`);
  const want = `/posters/${item.id}.jpg`;
  if (item.posterUrl !== want) fail(`"${item.id}" has posterUrl ${item.posterUrl}, expected ${want}`);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [id, [row, col]] of Object.entries(TILES)) {
  if (row < 0 || row >= rows.length || col < 0 || col >= cols.length) {
    fail(`tile "${id}" index [${row}, ${col}] is outside the ${cols.length}x${rows.length} grid`);
  }
  const [x0, x1] = cols[col];
  const [y0, y1] = rows[row];
  const out = join(OUT_DIR, `${id}.jpg`);
  run(MAGICK, [SRC, '-crop', `${x1 - x0}x${y1 - y0}+${x0}+${y0}`, '+repage', '-quality', '85', out]);
  if (!existsSync(out)) fail(`"${id}" produced no file at ${out}`);
  const size = statSync(out).size;
  if (size === 0) fail(`"${id}" produced a 0-byte file at ${out}`);
  const dims = run(MAGICK, ['identify', '-format', '%wx%h', out]).toString().trim();
  console.log(`${id}.jpg ${dims} ${size} bytes`);
}
