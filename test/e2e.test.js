import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { startServer } from "./server.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = path.join(root, "bin", "http-bench.js");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

let server;
before(async () => { server = await startServer(); });
after(() => server.close());

/** Run the executable (asynchronously: the test server lives in this process). */
function cli(args, { onStarted } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    onStarted?.(child);
  });
}

describe("the http-bench executable", () => {
  it("is executable and has a node shebang", { skip: process.platform === "win32" }, () => {
    assert.ok(fs.statSync(bin).mode & 0o111, "bin/http-bench.js should be executable");
    assert.match(fs.readFileSync(bin, "utf8"), /^#!\/usr\/bin\/env node\n/);
  });

  it("runs a benchmark and exits 0", async () => {
    const { code, stdout, stderr } = await cli(["-n", "20", "-c", "4", `${server.url}/ok`]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /^GET .*\/ok\n20 requests in /);
  });

  it("exit status: 1 for a failed threshold, 2 for usage errors, 3 when nothing succeeds", async () => {
    assert.equal((await cli(["-n", "5", "--threshold", "p50<0.0001ms", `${server.url}/ok`])).code, 1);
    const usage = await cli(["--bogus"]);
    assert.equal(usage.code, 2);
    assert.match(usage.stderr, /^http-bench: /);
    assert.equal((await cli(["-n", "3", `${server.url}/drop`])).code, 3);
  });

  it("prints JSON that can be fed back to --compare", async () => {
    const first = await cli(["--json", "-n", "20", `${server.url}/ok`]);
    const file = path.join(fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "http-bench-")), "before.json");
    fs.writeFileSync(file, first.stdout);
    try {
      const second = await cli(["-n", "20", "--compare", file, `${server.url}/ok`]);
      assert.equal(second.code, 0);
      assert.match(second.stdout, /\nCompared with .*before\.json\n/);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("stops on SIGINT, prints the partial report and exits 130", { skip: process.platform === "win32" }, async () => {
    const result = await cli(["-d", "60s", "-c", "2", `${server.url}/slow?ms=20`], {
      onStarted: (child) => setTimeout(() => child.kill("SIGINT"), 400),
    });
    assert.equal(result.code, 130, result.stderr);
    assert.match(result.stdout, /^Interrupted: the results cover the first /);
    assert.match(result.stdout, /\nLatency\n/);
  });

  it("reports its version and help", async () => {
    assert.equal((await cli(["--version"])).stdout, `http-bench ${pkg.version}\n`);
    assert.match((await cli(["--help"])).stdout, /^Usage: http-bench/);
  });
});
