import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { main } from "../src/cli.js";
import { capture } from "./helpers.js";
import { startServer } from "./server.js";

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
