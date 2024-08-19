import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { histogram, percentile, summarize } from "../src/stats.js";

const oneTo = (n) => Array.from({ length: n }, (_, i) => i + 1);

describe("percentile", () => {
  it("uses the nearest-rank method", () => {
    const hundred = oneTo(100);
    assert.equal(percentile(hundred, 50), 50);
    assert.equal(percentile(hundred, 90), 90);
    assert.equal(percentile(hundred, 99), 99);
    assert.equal(percentile(hundred, 100), 100);
    assert.equal(percentile(hundred, 0), 1);
    assert.equal(percentile(oneTo(4), 50), 2);
    assert.equal(percentile(oneTo(10), 95), 10);
  });

  it("returns the only value for any percentile of a single value", () => {
    for (const p of [0, 1, 50, 99.9, 100]) assert.equal(percentile([42], p), 42);
  });

  it("returns null for no values", () => {
    assert.equal(percentile([], 50), null);
  });
});

describe("histogram", () => {
  it("counts every value exactly once", () => {
    const values = Array.from({ length: 500 }, (_, i) => (i * 37) % 101);
    const rows = histogram(values, 8);
    assert.equal(rows.reduce((sum, row) => sum + row.count, 0), 500);
  });

  it("makes equal-width bins from the minimum up to the 99th percentile", () => {
    const rows = histogram(oneTo(100), 10);
    assert.equal(rows.length, 11); // ten bins and the slowest 1% (just the value 100)
    assert.deepEqual([rows[0].from, rows[9].to], [1, 99]);
    assert.ok(rows.slice(0, 10).every((row, i, all) => i === 0 || Math.abs(row.from - all[i - 1].to) < 1e-9));
    assert.deepEqual(rows[10], { from: 99, to: 100, count: 1, tail: true });
    assert.equal(rows[9].count, 10); // 89.2 up to 99 holds 90..99
  });

  it("keeps outliers out of the main bins", () => {
    const values = [...Array.from({ length: 98 }, () => 10), 11, 5000];
    const rows = histogram(values, 4);
    assert.equal(rows.at(-1).tail, true);
    assert.ok(rows.every((row) => row.to <= 5000));
    assert.ok(rows[0].count >= 98);
  });

  it("collapses to one row when all values are equal, and to none for no values", () => {
    assert.deepEqual(histogram([5, 5, 5]), [{ from: 5, to: 5, count: 3 }]);
    assert.deepEqual(histogram([]), []);
    assert.deepEqual(histogram([7]), [{ from: 7, to: 7, count: 1 }]);
  });
});

describe("summarize", () => {
  it("reports count, extremes, mean and standard deviation", () => {
    const stats = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    assert.equal(stats.count, 8);
    assert.equal(stats.min, 2);
    assert.equal(stats.max, 9);
    assert.equal(stats.mean, 5);
    assert.ok(Math.abs(stats.stddev - Math.sqrt(32 / 7)) < 1e-12);
  });

  it("does not need sorted input and does not modify it", () => {
    const input = [30, 10, 20];
    const stats = summarize(input, [50]);
    assert.deepEqual(input, [30, 10, 20]);
    assert.deepEqual([stats.min, stats.max, stats.percentiles[50]], [10, 30, 20]);
  });

  it("handles one value and no values", () => {
    const one = summarize([7]);
    assert.deepEqual([one.min, one.max, one.mean, one.stddev], [7, 7, 7, 0]);
    assert.deepEqual(summarize([]), { count: 0, min: null, max: null, mean: null, stddev: null, percentiles: {} });
  });

  it("computes the requested percentiles", () => {
    const stats = summarize(oneTo(1000), [50, 99, 99.9]);
    assert.deepEqual(stats.percentiles, { 50: 500, 99: 990, 99.9: 999 });
  });
});
