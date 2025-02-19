import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LatencyHistogram } from "../src/histogram.js";

// A deterministic spread of latencies between 0.2 and about 200 ms with a long tail.
function samples(n) {
  let state = 12345;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  return Array.from({ length: n }, () => 0.2 + 15 * -Math.log(1 - next()) + (next() < 0.01 ? 150 * next() : 0));
}

function exactPercentile(sorted, p) {
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p * sorted.length) / 100 - 1e-9))) - 1];
}

describe("LatencyHistogram", () => {
  it("keeps count, extremes and mean exactly", () => {
    const histogram = new LatencyHistogram();
    const values = samples(5000);
    for (const value of values) histogram.record(value);
    assert.equal(histogram.count, 5000);
    assert.equal(histogram.min, Math.min(...values));
    assert.equal(histogram.max, Math.max(...values));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(Math.abs(histogram.mean - mean) < 1e-9);
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    assert.ok(Math.abs(histogram.stddev - Math.sqrt(variance)) < 1e-9);
  });

  it("estimates percentiles within the relative precision", () => {
    const histogram = new LatencyHistogram();
    const values = samples(20000);
    for (const value of values) histogram.record(value);
    const sorted = Float64Array.from(values).sort();
    for (const p of [1, 25, 50, 75, 90, 95, 99, 99.9]) {
      const exact = exactPercentile(sorted, p);
      const estimate = histogram.percentile(p);
      assert.ok(Math.abs(estimate - exact) / exact <= 0.0101, `p${p}: ${estimate} vs ${exact}`);
    }
    assert.equal(histogram.percentile(100), histogram.max);
    assert.equal(histogram.percentile(0), histogram.min);
  });

  it("is exact for a single value, and never reports outside the observed range", () => {
    const histogram = new LatencyHistogram();
    histogram.record(12.345);
    for (const p of [0, 50, 99.9, 100]) assert.equal(histogram.percentile(p), 12.345);
    assert.equal(histogram.stddev, 0);
  });

  it("uses the same memory however many values it sees", () => {
    const histogram = new LatencyHistogram();
    const size = histogram.counts.length;
    for (const value of samples(50000)) histogram.record(value);
    assert.equal(histogram.counts.length, size);
    assert.ok(size < 3000);
  });

  it("handles values at the edges: zero, below a microsecond, beyond an hour", () => {
    const histogram = new LatencyHistogram();
    for (const value of [0, 0.0005, 0.0007, 5e9]) histogram.record(value);
    assert.equal(histogram.count, 4);
    assert.equal(histogram.min, 0);
    assert.equal(histogram.max, 5e9);
    assert.equal(histogram.percentile(75), 0.001); // below one microsecond: reported as one microsecond
    assert.equal(histogram.percentile(100), 5e9);
  });

  it("rejects negative and non-numeric values", () => {
    const histogram = new LatencyHistogram();
    for (const bad of [-1, NaN, undefined]) assert.throws(() => histogram.record(bad), RangeError);
    assert.equal(histogram.count, 0);
  });

  it("has no percentile without values", () => {
    assert.equal(new LatencyHistogram().percentile(50), null);
    assert.deepEqual(new LatencyHistogram().rows(), []);
  });
});

describe("LatencyHistogram.rows", () => {
  it("accounts for every value exactly once", () => {
    const histogram = new LatencyHistogram();
    for (const value of samples(3000)) histogram.record(value);
    const rows = histogram.rows(8);
    assert.equal(rows.reduce((sum, row) => sum + row.count, 0), 3000);
    assert.ok(rows.length <= 9);
  });

  it("has equal-width bins up to the 99th percentile and a row for the slowest 1%", () => {
    const histogram = new LatencyHistogram();
    for (let i = 1; i <= 100; i += 1) histogram.record(i);
    const rows = histogram.rows(10);
    const body = rows.filter((row) => !row.tail);
    assert.equal(body.length, 10);
    assert.equal(body[0].from, 1);
    assert.ok(body.every((row, i) => i === 0 || Math.abs(row.from - body[i - 1].to) < 1e-9));
    assert.equal(rows.at(-1).tail, true);
    assert.equal(rows.at(-1).count, 1);
  });

  it("keeps outliers out of the main bins", () => {
    const histogram = new LatencyHistogram();
    for (let i = 0; i < 98; i += 1) histogram.record(10);
    histogram.record(11);
    histogram.record(5000);
    const rows = histogram.rows(4);
    assert.ok(rows[0].count >= 98);
    assert.equal(rows.at(-1).tail, true);
    assert.equal(rows.at(-1).to, 5000);
  });

  it("is one row when all values are equal", () => {
    const histogram = new LatencyHistogram();
    for (let i = 0; i < 5; i += 1) histogram.record(7);
    assert.deepEqual(histogram.rows(), [{ from: 7, to: 7, count: 5 }]);
  });
});
