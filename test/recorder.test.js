import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyze } from "../src/analysis.js";
import { Recorder } from "../src/recorder.js";

describe("Recorder", () => {
  it("counts responses, statuses, bytes and failures", () => {
    const recorder = new Recorder();
    recorder.record({ latency: 5, status: 200, bytes: 100 });
    recorder.record({ latency: 7, status: 200, bytes: 50 });
    recorder.record({ latency: 9, status: 404, bytes: 10 });
    recorder.record({ latency: 11, status: 503, bytes: 0 });
    recorder.record({ error: "timeout" });
    recorder.record({ error: "timeout" });
    recorder.record({ error: "ECONNRESET" });
    assert.equal(recorder.requests, 7);
    assert.equal(recorder.responses, 4);
    assert.equal(recorder.successes, 2);
    assert.equal(recorder.bytes, 160);
    assert.deepEqual([...recorder.statusCodes], [[200, 2], [404, 1], [503, 1]]);
    assert.deepEqual([...recorder.errorCounts], [["HTTP 404", 1], ["HTTP 503", 1], ["timeout", 2], ["ECONNRESET", 1]]);
    assert.equal(recorder.histogram.count, 4);
  });

  it("keeps a per-second timeline of requests and failures", () => {
    const recorder = new Recorder();
    recorder.record({ latency: 1, status: 200 }, 100);
    recorder.record({ latency: 1, status: 200 }, 900);
    recorder.record({ latency: 1, status: 500 }, 1000);
    recorder.record({ error: "timeout" }, 3500);
    assert.deepEqual(recorder.timeline, [
      { requests: 2, failed: 0 }, { requests: 1, failed: 1 }, { requests: 0, failed: 0 }, { requests: 1, failed: 1 },
    ]);
    assert.deepEqual(analyze({ recorder, elapsedMs: 4000 }).timeline[3], { second: 3, requests: 1, failed: 1 });
  });

  it("does not put failed requests into the latency histogram", () => {
    const recorder = new Recorder();
    recorder.record({ error: "timeout" });
    assert.equal(recorder.histogram.count, 0);
  });

  it("a negative latency (from a timer that fired early) counts as zero", () => {
    const recorder = new Recorder();
    recorder.record({ latency: -0.4, status: 200 });
    recorder.record({ latency: 3, status: 200 });
    assert.equal(recorder.requests, 2);
    assert.equal(recorder.successes, 2);
    assert.equal(recorder.histogram.min, 0);
    assert.equal(recorder.errorCounts.size, 0);
  });

  it("redirects are successes", () => {
    const recorder = new Recorder();
    recorder.record({ latency: 1, status: 302 });
    assert.equal(recorder.successes, 1);
    assert.equal(recorder.errorCounts.size, 0);
  });
});

describe("analyze", () => {
  it("summarises a recorder", () => {
    const recorder = new Recorder();
    for (let i = 1; i <= 100; i += 1) recorder.record({ latency: i, status: i <= 90 ? 200 : 500, bytes: 10 });
    recorder.record({ error: "timeout" });
    const analysis = analyze({ recorder, elapsedMs: 2000 });
    assert.equal(analysis.requests, 101);
    assert.equal(analysis.successes, 90);
    assert.equal(analysis.errors, 11);
    assert.equal(analysis.requestsPerSecond, 50.5);
    assert.equal(analysis.bytes, 1000);
    assert.deepEqual(analysis.statusCodes, { 200: 90, 500: 10 });
    assert.deepEqual(analysis.errorCounts, { "HTTP 500": 10, timeout: 1 });
    assert.equal(analysis.latency.count, 100);
    assert.equal(analysis.latency.min, 1);
    assert.equal(analysis.latency.max, 100);
    assert.ok(Math.abs(analysis.latency.mean - 50.5) < 1e-9);
    assert.deepEqual(Object.keys(analysis.latency.percentiles), ["50", "75", "90", "95", "99", "99.9"]);
    assert.ok(Math.abs(analysis.latency.percentiles[50] - 50) / 50 <= 0.0101);
  });

  it("has no latency numbers without responses", () => {
    const recorder = new Recorder();
    recorder.record({ error: "ECONNREFUSED" });
    const analysis = analyze({ recorder, elapsedMs: 10 });
    assert.deepEqual(analysis.latency, { count: 0, min: null, max: null, mean: null, stddev: null, percentiles: {} });
    assert.deepEqual(analysis.histogram, []);
    assert.equal(analysis.successes, 0);
  });
});
