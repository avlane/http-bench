import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { percentile, summarize } from "../src/stats.js";

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
