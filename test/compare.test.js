import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { compareRuns, comparisonLines, loadBaseline } from "../src/compare.js";

function report({ p50 = 10, p99 = 50, mean = 12, rps = 500, requests = 1000, errors = 0, percentiles } = {}) {
  return {
    version: 1,
    tool: { name: "http-bench", version: "0.1.0" },
    summary: { requests, errors, requestsPerSecond: rps },
    latencyMs: { mean, percentiles: percentiles ?? { 50: p50, 99: p99 } },
  };
}

const row = (comparison, metric) => comparison.rows.find((r) => r.metric === metric);

describe("compareRuns", () => {
  it("computes the relative change of each metric", () => {
    const comparison = compareRuns(report(), report({ p50: 11, p99: 40, rps: 450, mean: 12 }));
    assert.ok(Math.abs(row(comparison, "p50").change - 10) < 1e-9);
    assert.ok(Math.abs(row(comparison, "p99").change - -20) < 1e-9);
    assert.ok(Math.abs(row(comparison, "rps").change - -10) < 1e-9);
    assert.equal(row(comparison, "mean").change, 0);
  });

  it("knows which direction is worse", () => {
    const comparison = compareRuns(report(), report({ p50: 11, p99: 40, rps: 450 }));
    assert.deepEqual(["p50", "p99", "rps"].map((m) => row(comparison, m).worse), [true, false, true]);
    const better = compareRuns(report(), report({ p50: 5, rps: 900 }));
    assert.ok(better.rows.every((r) => !r.worse));
  });

  it("compares the error rate in percentage points", () => {
    const comparison = compareRuns(report({ errors: 5 }), report({ errors: 20 }));
    assert.equal(row(comparison, "errors").before, 0.5);
    assert.equal(row(comparison, "errors").after, 2);
    assert.equal(row(comparison, "errors").change, 1.5);
    assert.equal(row(comparison, "errors").worse, true);
  });

  it("flags regressions beyond the allowed percentage", () => {
    const current = report({ p50: 10.5, p99: 60, rps: 495 });
    const lenient = compareRuns(report(), current, { maxRegression: 25 });
    assert.equal(lenient.regressed, false);
    const strict = compareRuns(report(), current, { maxRegression: 10 });
    assert.equal(strict.regressed, true);
    assert.deepEqual(strict.rows.filter((r) => r.regressed).map((r) => r.metric), ["p99"]);
    assert.equal(compareRuns(report(), current).regressed, false);
  });

  it("skips metrics that are missing from either report and copes with zero baselines", () => {
    const comparison = compareRuns(report({ percentiles: { 50: 10 } }), report({ percentiles: { 50: 12, 99: 90 } }));
    assert.deepEqual(comparison.rows.map((r) => r.metric).filter((m) => m.startsWith("p")), ["p50"]);
    const fromZero = compareRuns(report({ rps: 0 }), report({ rps: 100 }));
    assert.equal(row(fromZero, "rps").change, null);
    assert.equal(row(fromZero, "rps").worse, false);
  });
});

describe("comparisonLines", () => {
  it("prints a table and marks regressions", () => {
    const comparison = { baseline: "old.json", ...compareRuns(report(), report({ p50: 10, p99: 75, rps: 400 }), { maxRegression: 20 }) };
    const lines = comparisonLines(comparison);
    assert.equal(lines[0], "Compared with old.json");
    assert.match(lines.find((l) => l.includes("p99")), /50\.0 ms +75\.0 ms +\+50\.0% {2}REGRESSION$/);
    assert.match(lines.find((l) => l.includes("rps")), /500\.0 +400\.0 +-20\.0% +worse$/);
    assert.match(lines.find((l) => l.includes("p50")), /\+0\.0%$/);
  });
});

describe("loadBaseline", () => {
  const dirs = [];
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  const write = (text) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "http-bench-"));
    dirs.push(dir);
    const file = path.join(dir, "baseline.json");
    fs.writeFileSync(file, text);
    return file;
  };

  it("accepts a report", () => {
    assert.equal(loadBaseline(write(JSON.stringify(report()))).summary.requests, 1000);
  });

  it("rejects other files with a clear message", () => {
    assert.throws(() => loadBaseline(write("nope")), /not valid JSON/);
    assert.throws(() => loadBaseline(write("{}")), /is not an http-bench --json report/);
    assert.throws(() => loadBaseline(write(JSON.stringify({ ...report(), version: 2 }))), /is not an http-bench/);
    assert.throws(() => loadBaseline("/no/such/baseline.json"), /cannot read baseline .*ENOENT/);
  });
});
