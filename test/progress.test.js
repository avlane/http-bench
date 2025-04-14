import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatProgress, startProgress } from "../src/progress.js";
import { Recorder } from "../src/recorder.js";

describe("formatProgress", () => {
  it("shows elapsed time, requests, rate and failures", () => {
    assert.equal(formatProgress({ elapsedMs: 12500, requests: 3412, failed: 7 }), "  12.5 s  3,412 requests  273 req/s  7 failed");
  });

  it("copes with a run that has just started", () => {
    assert.equal(formatProgress({ elapsedMs: 0, requests: 0, failed: 0 }), "   0.0 s  0 requests  0 req/s  0 failed");
  });
});

describe("startProgress", () => {
  it("redraws the line while running and erases it when stopped", async () => {
    const written = [];
    const recorder = new Recorder();
    let clock = 0;
    const stop = startProgress(recorder, { write: (text) => written.push(text) }, { intervalMs: 10, now: () => clock });
    recorder.record({ latency: 1, status: 200 });
    recorder.record({ error: "timeout" });
    clock = 2000;
    await new Promise((resolve) => setTimeout(resolve, 35));
    stop();
    const frames = written.slice(0, -1);
    assert.ok(frames.length >= 2, `${frames.length} frames`);
    assert.ok(frames.every((frame) => frame.startsWith("\r")));
    assert.match(frames.at(-1), /2\.0 s {2}2 requests {2}1 req\/s {2}1 failed$/);
    assert.equal(written.at(-1), "\r\x1b[K");
    const count = written.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(written.length, count, "no updates after stop()");
  });
});
