/** Summary statistics for a run of wall-clock samples. No thresholds live here. */
import { cpus, loadavg } from 'node:os';

const round = (n, places = 1) => Number(n.toFixed(places));

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Count, median, and the observed min and max.
 *
 * That range is the spread these five samples happened to produce, not a confidence interval.
 * A reader comparing two runs should treat a gap smaller than the wider of the two ranges as
 * unproven, and should not read a small gap as a regression.
 */
export function summarize(values) {
  if (!values.length) return { n: 0, median: null, min: null, max: null };
  return {
    n: values.length,
    median: round(medianOf(values)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

/** A number recorded next to a busy-machine reading means something different from one recorded on an idle box. */
export const load1 = () => round(loadavg()[0], 2);

export const machine = () => ({
  cores: cpus().length,
  load1: load1(),
  node: process.version,
});
