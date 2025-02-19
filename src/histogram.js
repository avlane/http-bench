/**
 * A latency histogram that needs the same small amount of memory however many values it
 * sees (the idea behind HdrHistogram). Buckets grow geometrically, so every value is
 * stored with a relative error of at most `precision` (1% by default) - plenty for
 * percentiles - while count, minimum, maximum, mean and standard deviation are exact.
 *
 * Bucket 0 holds values up to `lowest`; bucket i holds (lowest * g^(i-1), lowest * g^i]
 * with g = 1 + precision. The defaults cover one microsecond to one hour in ~2,200 buckets.
 */
export class LatencyHistogram {
  constructor({ lowest = 0.001, highest = 3_600_000, precision = 0.01 } = {}) {
    this.lowest = lowest;
    this.precision = precision;
    this.logGrowth = Math.log1p(precision);
    this.counts = new Float64Array(Math.ceil(Math.log(highest / lowest) / this.logGrowth) + 1);
    this.count = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.mean = 0;
    this.squares = 0; // sum of squared deviations from the mean (Welford)
  }

  bucketOf(value) {
    if (value <= this.lowest) return 0;
    return Math.min(this.counts.length - 1, Math.ceil(Math.log(value / this.lowest) / this.logGrowth));
  }

  upperBound(bucket) {
    return this.lowest * (1 + this.precision) ** bucket;
  }

  record(value) {
    if (!(value >= 0)) throw new RangeError(`cannot record ${value}`);
    this.counts[this.bucketOf(value)] += 1;
    this.count += 1;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    this.squares += delta * (value - this.mean);
  }

  get stddev() {
    return this.count > 1 ? Math.sqrt(this.squares / (this.count - 1)) : 0;
  }

  /** The p-th percentile (0-100), nearest-rank, within `precision` of the true value. */
  percentile(p) {
    if (this.count === 0) return null;
    const rank = Math.min(this.count, Math.max(1, Math.ceil((p * this.count) / 100 - 1e-9)));
    // The first and the last value are known exactly.
    if (rank === 1) return this.min;
    if (rank === this.count) return this.max;
    let seen = 0;
    for (let bucket = 0; bucket < this.counts.length; bucket += 1) {
      seen += this.counts[bucket];
      if (seen >= rank) return Math.min(this.max, Math.max(this.min, this.upperBound(bucket)));
    }
    return this.max;
  }

  /**
   * Rows for a text histogram: `bins` equal-width bins from the minimum to the 99th
   * percentile plus one row ("tail") for everything slower, so that a few outliers don't
   * squash the rest into one bin. Rows are {from, to, count[, tail]}.
   */
  rows(bins = 10) {
    if (this.count === 0) return [];
    const upper = this.percentile(99);
    if (!(upper > this.min)) return [{ from: this.min, to: this.max, count: this.count }];
    const width = (upper - this.min) / bins;
    const rows = Array.from({ length: bins }, (_, i) => ({ from: this.min + i * width, to: this.min + (i + 1) * width, count: 0 }));
    const tail = { from: upper, to: this.max, count: 0, tail: true };
    for (let bucket = 0; bucket < this.counts.length; bucket += 1) {
      const count = this.counts[bucket];
      if (count === 0) continue;
      const value = Math.min(this.max, Math.max(this.min, this.upperBound(bucket)));
      if (value > upper) tail.count += count;
      else rows[Math.min(bins - 1, Math.floor((value - this.min) / width))].count += count;
    }
    if (tail.count > 0) rows.push(tail);
    return rows;
  }
}
