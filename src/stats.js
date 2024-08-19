/**
 * The p-th percentile (0-100) of an ascending list, by the nearest-rank method: the
 * smallest value such that at least p percent of the values are less than or equal to it.
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  // p * n first: (p / 100) * n gives 999.0000000000001 for p = 99.9, n = 1000 and rounds up.
  const rank = Math.ceil((p * sorted.length) / 100 - 1e-9);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/**
 * A histogram for display: `bins` equal-width bins from the smallest value to the 99th
 * percentile, plus one row for the slowest 1% so that a few outliers don't squash
 * everything else into the first bin. Rows are {from, to, count[, tail]}.
 */
export function histogram(values, bins = 10) {
  if (values.length === 0) return [];
  const sorted = Float64Array.from(values).sort();
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const upper = percentile(sorted, 99);
  if (!(upper > min)) return [{ from: min, to: max, count: sorted.length }];
  const width = (upper - min) / bins;
  const rows = Array.from({ length: bins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  const tail = { from: upper, to: max, count: 0, tail: true };
  for (const value of sorted) {
    if (value > upper) tail.count += 1;
    else rows[Math.min(bins - 1, Math.floor((value - min) / width))].count += 1;
  }
  if (tail.count > 0) rows.push(tail);
  return rows;
}

export const DEFAULT_PERCENTILES = [50, 75, 90, 95, 99, 99.9];

/** Summary statistics of a list of numbers (latencies in milliseconds). */
export function summarize(values, percentiles = DEFAULT_PERCENTILES) {
  const count = values.length;
  if (count === 0) return { count: 0, min: null, max: null, mean: null, stddev: null, percentiles: {} };
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (const value of sorted) sum += value;
  const mean = sum / count;
  let squares = 0;
  for (const value of sorted) squares += (value - mean) ** 2;
  return {
    count,
    min: sorted[0],
    max: sorted[count - 1],
    mean,
    // Sample standard deviation; a single value has none.
    stddev: count > 1 ? Math.sqrt(squares / (count - 1)) : 0,
    percentiles: Object.fromEntries(percentiles.map((p) => [p, percentile(sorted, p)])),
  };
}
