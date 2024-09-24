import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { main } from "../src/cli.js";
import { capture } from "./helpers.js";
import { closedPort, startServer } from "./server.js";

let server;
before(async () => { server = await startServer(); });
after(() => server.close());

async function run(args) {
  const { io, out } = capture();
  const code = await main(args, io);
  return { code, ...out };
}

describe("cli", () => {
  it("runs the benchmark and prints a report", async () => {
    server.requests.length = 0;
    const { code, stdout, stderr } = await run(["-n", "30", "-c", "3", `${server.url}/ok`]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.equal(server.requests.length, 30);
    assert.match(stdout, new RegExp(`^GET ${server.url}/ok\\n30 requests in [\\d.]+ s with concurrency 3\\n`));
    assert.match(stdout, /\n[\d.]+ requests\/s\n/);
    for (const label of ["min", "mean", "p50", "p90", "p99", "max"]) assert.match(stdout, new RegExp(`\\n  ${label} +[\\d.]+ ms\\n`), label);
  });

  it("draws a latency histogram", async () => {
    const { stdout } = await run(["-n", "60", "-c", "4", `${server.url}/slow?ms=3`]);
    const section = stdout.split("\nHistogram\n")[1];
    assert.ok(section, "no Histogram section");
    const rows = section.trimEnd().split("\n");
    assert.ok(rows.length >= 2 && rows.length <= 11, `${rows.length} rows`);
    assert.ok(rows.every((row) => /ms +\u2588* +\d+ +[\d.]+%/.test(row)), section);
    const total = rows.reduce((sum, row) => sum + Number(/ (\d+) +[\d.]+%/.exec(row)[1]), 0);
    assert.equal(total, 60);
  });

  it("prints JSON with --json", async () => {
    const { code, stdout, stderr } = await run(["--json", "-n", "40", "-c", "4", "-H", "Authorization: Bearer topsecret", "-H", "X-Test: 1", `${server.url}/ok`]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    const doc = JSON.parse(stdout);
    assert.equal(doc.version, 1);
    assert.equal(doc.tool.name, "http-bench");
    assert.deepEqual(doc.config, {
      url: `${server.url}/ok`, method: "GET", concurrency: 4, requests: 40, durationMs: null, warmup: null,
      timeoutMs: 10000, bodyBytes: 0,
      headers: { authorization: "<redacted>", "x-test": "1", "user-agent": doc.config.headers["user-agent"] },
    });
    assert.equal(doc.summary.requests, 40);
    assert.equal(doc.summary.errors, 0);
    assert.ok(doc.summary.requestsPerSecond > 0);
    for (const key of ["min", "mean", "stddev", "max"]) assert.equal(typeof doc.latencyMs[key], "number", key);
    assert.deepEqual(Object.keys(doc.latencyMs.percentiles), ["50", "75", "90", "95", "99", "99.9"]);
    assert.ok(doc.latencyMs.min <= doc.latencyMs.percentiles[50] && doc.latencyMs.percentiles[99] <= doc.latencyMs.max);
    assert.equal(doc.histogram.reduce((sum, row) => sum + row.count, 0), 40);
    assert.ok(!stdout.includes("topsecret"));
  });

  it("JSON output is valid even when every request fails", async () => {
    const { code, stdout } = await run(["--json", "-n", "3", `${server.url}/drop`]);
    assert.equal(code, 3);
    const doc = JSON.parse(stdout);
    assert.equal(doc.summary.errors, 3);
    assert.equal(doc.latencyMs.min, null);
    assert.deepEqual(doc.histogram, []);
    assert.equal(Object.values(doc.errors).reduce((a, b) => a + b, 0), 3);
  });

  it("uses 100 requests and 10 connections by default", async () => {
    server.requests.length = 0;
    const { stdout } = await run([`${server.url}/ok`]);
    assert.equal(server.requests.length, 100);
    assert.match(stdout, /100 requests in .* concurrency 10/);
  });

  it("runs for a duration with -d", async () => {
    server.requests.length = 0;
    const { code, stdout } = await run(["-d", "200ms", "-c", "2", `${server.url}/slow?ms=20`]);
    assert.equal(code, 0);
    assert.ok(server.requests.length >= 8, `only ${server.requests.length} requests`);
    assert.match(stdout, new RegExp(`${server.requests.length} requests in 0\\.\\d\\d s`));
  });

  it("combines -n and -d: whichever limit comes first", async () => {
    server.requests.length = 0;
    await run(["-n", "7", "-d", "10s", `${server.url}/ok`]);
    assert.equal(server.requests.length, 7);
  });

  it("sends the method, headers and body it was given", async () => {
    server.requests.length = 0;
    const { code } = await run(["-n", "2", "-X", "PUT", "-H", "X-Test: yes", "-H", "Accept: text/plain", "-b", "payload", `${server.url}/echo`]);
    assert.equal(code, 0);
    assert.equal(server.requests.length, 2);
    for (const request of server.requests) {
      assert.equal(request.method, "PUT");
      assert.equal(request.headers["x-test"], "yes");
      assert.equal(request.headers.accept, "text/plain");
      assert.equal(request.body.toString(), "payload");
      assert.match(request.headers["user-agent"], /^http-bench\/\d+\.\d+\.\d+$/);
    }
  });

  it("a body without a method means POST", async () => {
    server.requests.length = 0;
    await run(["-n", "1", "-b", "x", `${server.url}/echo`]);
    assert.equal(server.requests[0].method, "POST");
  });

  it("rejects malformed headers, bodies on GET and unreadable body files", async () => {
    for (const args of [["-H", "oops"], ["-X", "GET", "-b", "x"], ["--body-file", "/no/such/file"], ["-b", "x", "--body-file", "y"]]) {
      const { code, stderr } = await run([...args, server.url]);
      assert.equal(code, 2, args.join(" "));
      assert.match(stderr, /^http-bench: /);
    }
  });

  it("gives up on slow requests after --timeout and reports them", async () => {
    const { code, stdout } = await run(["-n", "4", "-c", "4", "--timeout", "50ms", `${server.url}/slow?ms=400`]);
    assert.equal(code, 3); // nothing succeeded
    assert.match(stdout, /\n4 failed \(timeout: 4\)\n/);
    assert.ok(!stdout.includes("Latency"));
  });

  it("reports connection errors and exits 3 when nothing could be reached", async () => {
    const { code, stdout } = await run(["-n", "3", `http://127.0.0.1:${await closedPort()}/`]);
    assert.equal(code, 3);
    assert.match(stdout, /\n3 failed \(ECONNREFUSED: 3\)\n/);
  });

  it("exits 0 when only some requests fail", async () => {
    const { code, stdout } = await run(["-n", "6", "-c", "1", `${server.url}/drop`]);
    assert.equal(code, 3);
    const mixed = await run(["-n", "4", `${server.url}/ok`]);
    assert.equal(mixed.code, 0);
    assert.ok(!mixed.stdout.includes("failed"));
    assert.ok(stdout.includes("6 failed"));
  });

  it("rejects bad timeouts", async () => {
    for (const bad of ["5", "0ms", "soon"]) {
      const { code, stderr } = await run(["--timeout", bad, server.url]);
      assert.equal(code, 2, bad);
      assert.match(stderr, /--timeout/, bad);
    }
  });

  it("--warmup takes a request count or a duration", async () => {
    server.requests.length = 0;
    const counted = await run(["-n", "5", "--warmup", "4", `${server.url}/ok`]);
    assert.equal(counted.code, 0);
    assert.equal(server.requests.length, 9);
    assert.match(counted.stdout, /\n5 requests in /);
    server.requests.length = 0;
    await run(["-n", "5", "--warmup", "80ms", "-c", "1", `${server.url}/slow?ms=15`]);
    assert.ok(server.requests.length > 5);
    for (const bad of ["0", "-3", "x"]) assert.equal((await run(["--warmup", bad, server.url])).code, 2, bad);
  });

  it("rejects bad durations", async () => {
    for (const bad of ["10", "fast", "0s"]) {
      const { code, stderr } = await run(["-d", bad, server.url]);
      assert.equal(code, 2, bad);
      assert.match(stderr, /--duration/, bad);
    }
  });

  it("rejects bad numbers, missing and extra URLs", async () => {
    for (const args of [["-n", "0", server.url], ["-c", "many", server.url], ["-n", "1.5", server.url], [], [server.url, server.url]]) {
      const { code, stdout, stderr } = await run(args);
      assert.equal(code, 2, args.join(" "));
      assert.equal(stdout, "");
      assert.match(stderr, /^http-bench: /);
    }
  });

  it("rejects URLs that are not http or https", async () => {
    assert.match((await run(["not a url"])).stderr, /not a valid URL/);
    assert.match((await run(["ftp://example.com/"])).stderr, /unsupported protocol ftp:/);
  });

  it("prints help and version", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage: http-bench/);
    assert.match((await run(["-v"])).stdout, /^http-bench \d+\.\d+\.\d+\n$/);
  });

  it("rejects unknown options", async () => {
    const { code, stderr } = await run(["--turbo", server.url]);
    assert.equal(code, 2);
    assert.match(stderr, /Unknown option '--turbo'/);
  });
});
