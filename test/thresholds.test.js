import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyze } from "../src/analysis.js";
import { Recorder } from "../src/recorder.js";
import { evaluateThresholds, formatActual, parseThreshold } from "../src/thresholds.js";

describe("parseThreshold", () => {
  it("parses latency, rate and error expectations", () => {
    assert.deepEqual(parseThreshold("p99<250ms"), { expression: "p99<250ms", metric: "p99", operator: "<", value: 250 });
    assert.deepEqual(parseThreshold(" mean <= 1.5s "), { expression: "mean<=1.5s", metric: "mean", operator: "<=", value: 1500 });
    assert.equal(parseThreshold("p99.9<1s").value, 1000);
    assert.deepEqual(parseThreshold("rps>=500"), { expression: "rps>=500", metric: "rps", operator: ">=", value: 500 });
    assert.deepEqual(parseThreshold("errors<0.5%"), { expression: "errors<0.5%", metric: "errors", operator: "<", value: 0.5 });
    assert.equal(parseThreshold("errors<1").value, 1);
    assert.equal(parseThreshold("max>0ms").operator, ">");
  });

  it("explains what is wrong with a bad expression", () => {
    const cases = {
      "p99": /invalid threshold/,
      "p99<250": /needs|invalid duration/,
      "p99<fast": /invalid duration/,
      "speed<5ms": /unknown metric 'speed'/,
      "rps>5%": /rps needs a number/,
      "errors<ten": /errors needs a percentage/,
      "p0<1ms": /between 0 and 100/,
      "p101<1ms": /between 0 and 100/,
      "": /invalid threshold/,
      "p99 = 5ms": /invalid threshold/,
    };
    for (const [text, pattern] of Object.entries(cases)) assert.throws(() => parseThreshold(text), pattern, JSON.stringify(text));
  });
});

function results({ latencies = [], failures = 0, elapsedMs = 1000 }) {
  const recorder = new Recorder();
  for (const latency of latencies) recorder.record({ latency, status: 200 });
  for (let i = 0; i < failures; i += 1) recorder.record({ error: "timeout" });
  return analyze({ recorder, elapsedMs });
}

describe("evaluateThresholds", () => {
  const latencies = Array.from({ length: 200 }, (_, i) => i + 1);

  it("compares percentiles, mean and extremes", () => {
    const analysis = results({ latencies });
    const outcome = evaluateThresholds(["p50<110ms", "p99<150ms", "mean>=100ms", "max<=200ms", "min>5ms"].map(parseThreshold), analysis);
    assert.deepEqual(outcome.map((o) => o.passed), [true, false, true, true, false]);
    assert.ok(Math.abs(outcome[0].actual - 100) / 100 < 0.011);
  });

  it("compares the request rate and the error percentage", () => {
    const analysis = results({ latencies: Array(95).fill(5), failures: 5, elapsedMs: 500 });
    const outcome = evaluateThresholds(["rps>=200", "rps>201", "errors<=5%", "errors<5%"].map(parseThreshold), analysis);
    assert.deepEqual(outcome.map((o) => o.passed), [true, false, true, false]);
    assert.equal(outcome[2].actual, 5);
  });

  it("a latency that was never measured fails the threshold", () => {
    const [outcome] = evaluateThresholds([parseThreshold("p99<1s")], results({ failures: 3 }));
    assert.deepEqual(outcome, { expression: "p99<1s", actual: null, passed: false });
  });

  it("no thresholds, no results", () => {
    assert.deepEqual(evaluateThresholds([], results({ latencies })), []);
  });
});

describe("formatActual", () => {
  it("shows each metric in its own unit", () => {
    assert.equal(formatActual({ expression: "p99<1s", actual: 187.4 }), "187 ms");
    assert.equal(formatActual({ expression: "rps>5", actual: 478.25 }), "478.3 req/s");
    assert.equal(formatActual({ expression: "errors<1%", actual: 0.5 }), "0.50%");
    assert.equal(formatActual({ expression: "p99<1s", actual: null }), "no data");
  });
});
