import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { main } from "../src/cli.js";
import { capture } from "./helpers.js";
import { closedPort, startServer } from "./server.js";

let server;
before(async () => { server = await startServer(); });
after(() => server.close());

function tempFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "http-bench-"));
  const file = path.join(dir, "requests.json");
  fs.writeFileSync(file, contents);
  return { dir: file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

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
      url: `${server.url}/ok`, method: "GET", concurrency: 4, rate: null, latencyFrom: "sent", redirect: "follow", requests: 40, durationMs: null, warmup: null,
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

  it("reports the amount of data received", async () => {
    const text = (await run(["-n", "4", "-c", "2", `${server.url}/big?kb=32&ms=1`])).stdout;
    assert.match(text, /\n128\.0 KiB received \(/);
    const doc = JSON.parse((await run(["--json", "-n", "4", `${server.url}/big?kb=32&ms=1`])).stdout);
    assert.equal(doc.summary.bytes, 4 * 32 * 1024);
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

  it("counts HTTP error statuses as failures and lists the status codes", async () => {
    const { code, stdout } = await run(["-n", "5", "-c", "1", `${server.url}/status/503`]);
    assert.equal(code, 3);
    assert.match(stdout, /\n5 failed \(HTTP 503: 5\)\n/);
    assert.match(stdout, /\nStatus codes\n {2}503 {2}5\n/);
  });

  it("redirect statuses are not failures", async () => {
    const { code, stdout } = await run(["-n", "3", `${server.url}/status/204`]);
    assert.equal(code, 0);
    assert.ok(!stdout.includes("failed"));
    assert.match(stdout, /\nStatus codes\n {2}204 {2}3\n/);
  });

  it("mixed results: exit 0 while something succeeded", async () => {
    const { code, stdout } = await run(["--json", "-n", "6", "-c", "1", `${server.url}/flaky`]);
    assert.equal(code, 0);
    const doc = JSON.parse(stdout);
    assert.deepEqual(doc.statusCodes, { 200: 4, 500: 2 });
    assert.deepEqual([doc.summary.successes, doc.summary.errors], [4, 2]);
    assert.deepEqual(doc.errors, { "HTTP 500": 2 });
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

  it("--rate limits the request rate", async () => {
    const started = Date.now();
    const { code, stdout } = await run(["-n", "9", "--rate", "40", "-c", "3", `${server.url}/ok`]);
    assert.equal(code, 0);
    assert.ok(Date.now() - started >= 190);
    assert.match(stdout, /\n9 requests in 0\.[2-9]\d s/);
    const doc = JSON.parse((await run(["--json", "-n", "2", "--rate", "100", server.url + "/ok"])).stdout);
    assert.equal(doc.config.rate, 100);
    for (const bad of ["0", "-5", "fast", "Infinity"]) assert.equal((await run(["--rate", bad, server.url])).code, 2, bad);
  });

  it("--threshold passes or fails the run", async () => {
    const pass = await run(["-n", "20", "--threshold", "p99<5s", "--threshold", "errors<1%", `${server.url}/ok`]);
    assert.equal(pass.code, 0);
    assert.match(pass.stdout, /\nThresholds\n {2}PASS {2}p99<5s {2}\([\d.]+ m?s\)\n {2}PASS {2}errors<1% {2}\(0\.00%\)\n/);
    const fail = await run(["-n", "20", "--threshold", "p50<0.001ms", "--threshold", "rps>1", `${server.url}/ok`]);
    assert.equal(fail.code, 1);
    assert.match(fail.stdout, /\n {2}FAIL {2}p50<0\.001ms/);
    assert.match(fail.stdout, /\n {2}PASS {2}rps>1 /);
  });

  it("thresholds are part of the JSON report", async () => {
    const { code, stdout } = await run(["--json", "-n", "10", "--threshold", "errors<1%", "--threshold", "max<0.001ms", `${server.url}/ok`]);
    assert.equal(code, 1);
    const doc = JSON.parse(stdout);
    assert.deepEqual(doc.thresholds.map((t) => [t.expression, t.passed]), [["errors<1%", true], ["max<0.001ms", false]]);
    assert.equal(doc.thresholds[0].actual, 0);
  });

  it("an error-rate threshold catches failing responses", async () => {
    const { code } = await run(["-n", "6", "-c", "1", "--threshold", "errors<10%", `${server.url}/flaky`]);
    assert.equal(code, 1);
  });

  it("exit 3 (nothing succeeded) wins over a failed threshold", async () => {
    const { code } = await run(["-n", "3", "--threshold", "errors<1%", `${server.url}/drop`]);
    assert.equal(code, 3);
  });

  it("rejects bad thresholds", async () => {
    for (const bad of ["p99", "p99<fast", "speed<1ms"]) {
      const { code, stderr } = await run(["--threshold", bad, server.url]);
      assert.equal(code, 2, bad);
      assert.match(stderr, /^http-bench: --threshold: invalid threshold/, bad);
    }
  });

  it("says that latency is measured from the due time when a rate is set", async () => {
    const withRate = await run(["-n", "3", "--rate", "100", `${server.url}/ok`]);
    assert.match(withRate.stdout, /\nLatency \(from the time each request was due\)\n/);
    const without = await run(["-n", "3", `${server.url}/ok`]);
    assert.match(without.stdout, /\nLatency\n/);
    const doc = JSON.parse((await run(["--json", "-n", "3", "--rate", "100", `${server.url}/ok`])).stdout);
    assert.equal(doc.config.latencyFrom, "scheduled");
  });

  it("--progress writes a live line to stderr and leaves stdout alone", async () => {
    const { io, out } = capture();
    const code = await main(["--progress", "--json", "-d", "250ms", "-c", "2", `${server.url}/slow?ms=20`], { ...io, progressIntervalMs: 20 });
    assert.equal(code, 0);
    JSON.parse(out.stdout);
    assert.match(out.stderr, /\r +\d+\.\d s +\d+ requests/);
    assert.ok(out.stderr.endsWith("\r\x1b[K"));
    const quiet = await run(["-n", "3", `${server.url}/ok`]);
    assert.equal(quiet.stderr, "");
  });

  it("--requests-file sends the described requests in turn", async () => {
    const { dir, cleanup } = tempFile([
      JSON.stringify({ url: "/ok" }),
      JSON.stringify({ url: "/echo", method: "POST", json: { n: 1 }, headers: { "X-Kind": "file" } }),
    ].join("\n"));
    try {
      server.requests.length = 0;
      const { code, stdout } = await run(["--requests-file", dir, "-n", "6", "-c", "1", "-H", "X-Run: all", server.url]);
      assert.equal(code, 0);
      assert.deepEqual(server.requests.map((r) => `${r.method} ${r.path}`), ["GET /ok", "POST /echo", "GET /ok", "POST /echo", "GET /ok", "POST /echo"]);
      const echo = server.requests[1];
      assert.equal(echo.headers["x-kind"], "file");
      assert.equal(echo.headers["x-run"], "all");
      assert.equal(echo.headers["content-type"], "application/json");
      assert.equal(echo.body.toString(), '{"n":1}');
      assert.match(stdout, new RegExp(`^2 requests in turn:\\n  GET ${server.url}/ok\\n  POST ${server.url}/echo\\n6 requests in`));
    } finally {
      cleanup();
    }
  });

  it("--requests-file needs absolute URLs without a base, and conflicts with --body", async () => {
    const { dir, cleanup } = tempFile(JSON.stringify([{ url: `${server.url}/ok` }]));
    try {
      assert.equal((await run(["--requests-file", dir, "-n", "2"])).code, 0);
      const withBody = await run(["--requests-file", dir, "-b", "x"]);
      assert.equal(withBody.code, 2);
      assert.match(withBody.stderr, /cannot be combined with --requests-file/);
      const relative = tempFile(JSON.stringify([{ url: "/ok" }]));
      try {
        const missingBase = await run(["--requests-file", relative.dir]);
        assert.equal(missingBase.code, 2);
        assert.match(missingBase.stderr, /give a base URL/);
      } finally {
        relative.cleanup();
      }
    } finally {
      cleanup();
    }
  });

  it("lists the requests in the JSON config", async () => {
    const { dir, cleanup } = tempFile(JSON.stringify([{ url: "/ok" }, { url: "/created", method: "POST", body: "abc" }]));
    try {
      const doc = JSON.parse((await run(["--json", "--requests-file", dir, "-n", "2", server.url])).stdout);
      assert.deepEqual(doc.config.targets, [
        { method: "GET", url: `${server.url}/ok`, bodyBytes: 0 },
        { method: "POST", url: `${server.url}/created`, bodyBytes: 3 },
      ]);
    } finally {
      cleanup();
    }
  });

  it("--redirect manual reports the redirect itself", async () => {
    const followed = await run(["--json", "-n", "3", `${server.url}/redirect`]);
    assert.deepEqual(JSON.parse(followed.stdout).statusCodes, { 200: 3 });
    const manual = await run(["--json", "-n", "3", "--redirect", "manual", `${server.url}/redirect`]);
    const doc = JSON.parse(manual.stdout);
    assert.deepEqual(doc.statusCodes, { 302: 3 });
    assert.equal(doc.config.redirect, "manual");
    assert.equal(manual.code, 0);
    const bad = await run(["--redirect", "error", server.url]);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /--redirect must be 'follow' or 'manual'/);
  });

  it("--compare shows the change against an earlier --json report", async () => {
    const first = await run(["--json", "-n", "20", `${server.url}/ok`]);
    const { dir, cleanup } = tempFile(first.stdout);
    try {
      const { code, stdout } = await run(["-n", "20", "--compare", dir, `${server.url}/slow?ms=30`]);
      assert.equal(code, 0); // informational unless --max-regression is given
      assert.match(stdout, new RegExp(`\\nCompared with ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n  metric`));
      assert.match(stdout, /\n {2}p50 .* ms .* ms +\+[\d.]+% +worse\n/);
      const doc = JSON.parse((await run(["--json", "-n", "10", "--compare", dir, `${server.url}/ok`])).stdout);
      assert.equal(doc.comparison.baseline, dir);
      assert.ok(doc.comparison.rows.some((row) => row.metric === "p99"));
    } finally {
      cleanup();
    }
  });

  it("--max-regression turns a slowdown into exit status 1", async () => {
    const first = await run(["--json", "-n", "20", `${server.url}/ok`]);
    const { dir, cleanup } = tempFile(first.stdout);
    try {
      const slow = await run(["-n", "10", "--compare", dir, "--max-regression", "20%", `${server.url}/slow?ms=40`]);
      assert.equal(slow.code, 1);
      assert.match(slow.stdout, /REGRESSION/);
      const generous = await run(["-n", "10", "--compare", dir, "--max-regression", "100000", `${server.url}/slow?ms=40`]);
      assert.equal(generous.code, 0);
    } finally {
      cleanup();
    }
  });

  it("rejects an unusable baseline and a lone --max-regression", async () => {
    const { dir, cleanup } = tempFile("not json");
    try {
      const bad = await run(["--compare", dir, server.url]);
      assert.equal(bad.code, 2);
      assert.match(bad.stderr, /cannot read baseline .*not valid JSON/);
    } finally {
      cleanup();
    }
    assert.match((await run(["--max-regression", "10", server.url])).stderr, /--max-regression needs --compare/);
    const { dir: other, cleanup: cleanupOther } = tempFile("{}");
    try {
      assert.match((await run(["--compare", other, "--max-regression", "lots", server.url])).stderr, /--max-regression must be a percentage/);
    } finally {
      cleanupOther();
    }
  });

  it("reports requests per second over time", async () => {
    const { stdout } = await run(["-d", "2300ms", "-c", "2", `${server.url}/slow?ms=20`]);
    assert.match(stdout, /\nRequests per second {2}[\u2581-\u2588]{3} {2}\(peak \d+\)\n/);
    const doc = JSON.parse((await run(["--json", "-d", "1500ms", "-c", "2", `${server.url}/slow?ms=20`])).stdout);
    assert.equal(doc.timeline.length, 2);
    assert.deepEqual(doc.timeline.map((t) => t.second), [0, 1]);
    assert.equal(doc.timeline.reduce((sum, t) => sum + t.requests, 0), doc.summary.requests);
    const short = await run(["-n", "5", `${server.url}/ok`]);
    assert.ok(!short.stdout.includes("Requests per second"));
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
