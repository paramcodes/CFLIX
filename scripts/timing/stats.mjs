/** Summary statistics for a run of wall-clock samples. No thresholds live here. */
import { cpus, loadavg } from 'node:os';

const round = (n, places = 1) => Number(n.toFixed(places));

/** Median. An even sample count averages the two middle values. */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Everything a reader needs to judge whether two runs differ: the count, the
 * median, and the observed spread. A gap smaller than the spread is no difference.
 */
export function summarize(values) {
  if (!values.length) return { n: 0, median: null, min: null, max: null };
  return {
    n: values.length,
    median: round(median(values)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

/** One-minute load average. A sample taken on a busy machine is not a number. */
export const load1 = () => round(loadavg()[0], 2);

export const cores = () => cpus().length;

export const machine = () => ({
  cores: cpus().length,
  load1: load1(),
  node: process.version,
});
