import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { describeError, run } from "../src/runner.js";
import { startServer } from "./server.js";

let server;
before(async () => { server = await startServer(); });
after(() => server.close());

describe("run", () => {
  it("sends exactly the requested number of requests and records status and latency", async () => {
    server.requests.length = 0;
    const { samples, elapsedMs } = await run({ url: `${server.url}/ok`, requests: 25, concurrency: 5 });
    assert.equal(samples.length, 25);
    assert.equal(server.requests.length, 25);
    assert.ok(samples.every((s) => s.status === 200 && s.latency > 0));
    assert.ok(elapsedMs > 0);
  });

  it("does not use more workers than requests", async () => {
    server.requests.length = 0;
    const { samples } = await run({ url: `${server.url}/ok`, requests: 3, concurrency: 50 });
    assert.equal(samples.length, 3);
  });

  it("never has more requests in flight than the concurrency", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { status: 200 };
    };
    const { samples } = await run({ url: "http://example.invalid/", requests: 40, concurrency: 4, fetchImpl });
    assert.equal(samples.length, 40);
    assert.equal(peak, 4);
  });

  it("records failures as errors instead of throwing", async () => {
    const { samples } = await run({ url: `${server.url}/drop`, requests: 4, concurrency: 2 });
    assert.equal(samples.length, 4);
    assert.ok(samples.every((s) => typeof s.error === "string" && s.status === undefined));
  });

  it("records HTTP error statuses as responses", async () => {
    const { samples } = await run({ url: `${server.url}/status/503`, requests: 3, concurrency: 1 });
    assert.deepEqual(samples.map((s) => s.status), [503, 503, 503]);
  });
});

describe("describeError", () => {
  it("prefers the system error code of the cause", () => {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) });
    assert.equal(describeError(error), "ECONNREFUSED");
  });

  it("recognises timeouts and falls back to the error name", () => {
    assert.equal(describeError(Object.assign(new Error("t"), { name: "TimeoutError" })), "timeout");
    assert.equal(describeError(new RangeError("x")), "RangeError");
    assert.equal(describeError(undefined), "error");
  });
});
