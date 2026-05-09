import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sleep } from "../src/sleep.js";

describe("sleep", () => {
  it("resolves after the time", async () => {
    const started = performance.now();
    await sleep(40);
    assert.ok(performance.now() - started >= 35);
  });

  it("resolves at once when the signal fires, and does not reject", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const started = performance.now();
    await sleep(60_000, controller.signal);
    assert.ok(performance.now() - started < 1000);
  });

  it("returns at once for a signal that is already aborted", async () => {
    const started = performance.now();
    await sleep(60_000, AbortSignal.abort());
    assert.ok(performance.now() - started < 1000);
  });

  it("leaves no timer behind when it is aborted", async () => {
    const controller = new AbortController();
    const waiting = sleep(60_000, controller.signal);
    controller.abort();
    await waiting;
    // The test process would not exit within a minute if the timer were still pending.
  });
});
