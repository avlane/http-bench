import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createPacer, describeError, run } from "../src/runner.js";
import { startServer } from "./server.js";

let server;
before(async () => { server = await startServer(); });
after(() => server.close());

describe("run", () => {
  it("sends exactly the requested number of requests and records status and latency", async () => {
    server.requests.length = 0;
    const { recorder, elapsedMs } = await run({ url: `${server.url}/ok`, requests: 25, concurrency: 5 });
    assert.equal(recorder.requests, 25);
    assert.equal(server.requests.length, 25);
    assert.equal(recorder.statusCodes.get(200), 25);
    assert.ok(recorder.histogram.min > 0);
    assert.ok(elapsedMs > 0);
  });

  it("stops sending when the duration is over and lets requests in flight finish", async () => {
    server.requests.length = 0;
    const { recorder, elapsedMs } = await run({ url: `${server.url}/slow?ms=20`, duration: 150, concurrency: 2 });
    assert.ok(recorder.requests >= 6 && recorder.requests <= 18, `got ${recorder.requests} requests`);
    assert.equal(recorder.successes, recorder.requests);
    assert.ok(elapsedMs >= 150 && elapsedMs < 600, `took ${elapsedMs} ms`);
    assert.equal(server.requests.length, recorder.requests);
  });

  it("stops at the request count when that comes first", async () => {
    const { recorder } = await run({ url: `${server.url}/ok`, requests: 5, duration: 5000, concurrency: 2 });
    assert.equal(recorder.requests, 5);
  });

  it("sends warmup requests first and leaves them out of the results", async () => {
    server.requests.length = 0;
    const { recorder } = await run({ url: `${server.url}/ok`, requests: 10, concurrency: 2, warmup: { requests: 6 } });
    assert.equal(recorder.requests, 10);
    assert.equal(server.requests.length, 16);
  });

  it("a warmup can be a duration", async () => {
    server.requests.length = 0;
    const { recorder } = await run({ url: `${server.url}/slow?ms=10`, requests: 3, concurrency: 1, warmup: { duration: 60 } });
    assert.equal(recorder.requests, 3);
    assert.ok(server.requests.length >= 3 + 3, `${server.requests.length} requests reached the server`);
  });

  it("does not use more workers than requests", async () => {
    server.requests.length = 0;
    const { recorder } = await run({ url: `${server.url}/ok`, requests: 3, concurrency: 50 });
    assert.equal(recorder.requests, 3);
  });

  it("never has more requests in flight than the concurrency", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const { recorder } = await run({ url: "http://example.invalid/", requests: 40, concurrency: 4, fetchImpl });
    assert.equal(recorder.requests, 40);
    assert.equal(peak, 4);
  });

  it("abandons requests that exceed the timeout", async () => {
    const { recorder, elapsedMs } = await run({ url: `${server.url}/slow?ms=500`, requests: 3, concurrency: 3, timeout: 40 });
    assert.deepEqual([...recorder.errorCounts], [["timeout", 3]]);
    assert.equal(recorder.responses, 0);
    assert.ok(elapsedMs >= 35 && elapsedMs < 300, `took ${elapsedMs} ms`);
  });

  it("does not time out requests that finish in time", async () => {
    const { recorder } = await run({ url: `${server.url}/slow?ms=10`, requests: 3, concurrency: 3, timeout: 2000 });
    assert.equal(recorder.statusCodes.get(200), 3);
  });

  it("measures until the whole body has arrived and counts the bytes", async () => {
    const { recorder } = await run({ url: `${server.url}/big?kb=64&ms=30`, requests: 2, concurrency: 1 });
    assert.equal(recorder.bytes, 2 * 64 * 1024);
    assert.ok(recorder.histogram.min >= 80, `latency ${recorder.histogram.min} ms is shorter than the time the body takes`);
  });

  it("a body that is cut off is an error, not a success", async () => {
    const { recorder } = await run({ url: `${server.url}/big?kb=64&ms=200`, requests: 1, concurrency: 1, timeout: 100 });
    assert.deepEqual([...recorder.errorCounts], [["timeout", 1]]);
    assert.equal(recorder.responses, 0);
  });

  it("records failures as errors instead of throwing", async () => {
    const { recorder } = await run({ url: `${server.url}/drop`, requests: 4, concurrency: 2 });
    assert.equal(recorder.requests, 4);
    assert.equal(recorder.responses, 0);
    assert.equal([...recorder.errorCounts.values()].reduce((a, b) => a + b, 0), 4);
  });

  it("records HTTP error statuses as responses", async () => {
    const { recorder } = await run({ url: `${server.url}/status/503`, requests: 3, concurrency: 1 });
    assert.equal(recorder.statusCodes.get(503), 3);
    assert.equal(recorder.errorCounts.get("HTTP 503"), 3);
    assert.equal(recorder.successes, 0);
  });
});

describe("createPacer", () => {
  it("hands out evenly spaced time slots and waits for each", async () => {
    let clock = 1000;
    const waits = [];
    const pace = createPacer(4, { now: () => clock, wait: async (ms) => { waits.push(ms); clock += ms; } });
    const slots = [await pace(), await pace(), await pace(), await pace()];
    assert.deepEqual(slots, [1000, 1250, 1500, 1750]);
    assert.deepEqual(waits, [250, 250, 250]);
  });

  it("reserves slots at once, so concurrent callers queue behind each other", async () => {
    const clock = 0;
    const pace = createPacer(10, { now: () => clock, wait: async () => {} });
    const slots = await Promise.all([pace(), pace(), pace()]);
    assert.deepEqual(slots, [0, 100, 200]);
  });

  it("does not wait for a slot that is already in the past", async () => {
    let clock = 0;
    const waits = [];
    const pace = createPacer(10, { now: () => clock, wait: async (ms) => waits.push(ms) });
    await pace();
    clock = 5000; // the caller was busy for a long time
    await pace();
    assert.deepEqual(waits, []);
  });
});

describe("run with a rate", () => {
  it("spreads the requests out", async () => {
    const { recorder, elapsedMs } = await run({ url: `${server.url}/ok`, requests: 11, concurrency: 5, rate: 50 });
    assert.equal(recorder.requests, 11);
    assert.ok(elapsedMs >= 190 && elapsedMs < 1000, `11 requests at 50/s took ${elapsedMs} ms`);
  });

  it("does not send after the duration is over", async () => {
    server.requests.length = 0;
    await run({ url: `${server.url}/ok`, duration: 300, concurrency: 2, rate: 10 });
    assert.ok(server.requests.length >= 2 && server.requests.length <= 4, `${server.requests.length} requests`);
  });
});

describe("latency under a rate", () => {
  it("includes the time a request waited because earlier responses were slow", async () => {
    // One worker, a request due every 50 ms, but each response takes 100 ms: the schedule
    // falls further behind with every request, and so does the latency.
    const { recorder } = await run({ url: `${server.url}/slow?ms=100`, requests: 5, concurrency: 1, rate: 20 });
    assert.equal(recorder.requests, 5);
    assert.ok(recorder.histogram.min >= 95, `fastest ${recorder.histogram.min}`);
    assert.ok(recorder.histogram.max >= 280, `the fifth request was due 200 ms before the first finished; slowest was ${recorder.histogram.max}`);
  });

  it("without a rate latency is just the response time", async () => {
    const { recorder } = await run({ url: `${server.url}/slow?ms=60`, requests: 4, concurrency: 1 });
    assert.ok(recorder.histogram.max < 200, `slowest ${recorder.histogram.max}`);
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
