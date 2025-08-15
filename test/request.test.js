import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { buildRequest, parseHeader } from "../src/request.js";

describe("parseHeader", () => {
  it("splits at the first colon and trims", () => {
    assert.deepEqual(parseHeader("Accept: application/json"), ["Accept", "application/json"]);
    assert.deepEqual(parseHeader("X-Time:12:30:45"), ["X-Time", "12:30:45"]);
    assert.deepEqual(parseHeader("X-Empty:"), ["X-Empty", ""]);
  });

  it("rejects text that is not a header", () => {
    for (const bad of ["nocolon", ": value", "Bad Name: x", "", "Na(me: x"]) {
      assert.throws(() => parseHeader(bad), /invalid header/, bad);
    }
  });
});

describe("buildRequest", () => {
  it("defaults to GET without a body and POST with one", () => {
    assert.equal(buildRequest({}).method, "GET");
    assert.equal(buildRequest({ body: "x" }).method, "POST");
    assert.equal(buildRequest({ method: "put", body: "x" }).method, "PUT");
    assert.equal(buildRequest({ method: "delete" }).method, "DELETE");
  });

  it("refuses a body on GET and HEAD, and a malformed method", () => {
    assert.throws(() => buildRequest({ method: "GET", body: "x" }), /GET requests cannot have a body/);
    assert.throws(() => buildRequest({ method: "head", body: "x" }), /HEAD requests cannot/);
    assert.throws(() => buildRequest({ method: "FE TCH" }), /invalid method/);
  });

  it("builds headers, keeps repeated ones and adds a default user agent", () => {
    const { headers } = buildRequest({ headers: ["Accept: a", "Accept: b", "X-Id: 7"], userAgent: "http-bench/9" });
    assert.equal(headers.get("accept"), "a, b");
    assert.equal(headers.get("x-id"), "7");
    assert.equal(headers.get("user-agent"), "http-bench/9");
  });

  it("does not override a user agent chosen by the user", () => {
    const { headers } = buildRequest({ headers: ["user-agent: mine"], userAgent: "http-bench/9" });
    assert.equal(headers.get("user-agent"), "mine");
  });

  it("reads the body from a file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "http-bench-"));
    try {
      const file = path.join(dir, "body.json");
      fs.writeFileSync(file, '{"a": 1}\n');
      const request = buildRequest({ bodyFile: file });
      assert.deepEqual(request.body, Buffer.from('{"a": 1}\n'));
      assert.equal(request.method, "POST");
      const binary = path.join(dir, "blob.bin");
      fs.writeFileSync(binary, Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x0a, 0xc3]));
      assert.deepEqual(buildRequest({ bodyFile: binary }).body, Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x0a, 0xc3]));
      assert.throws(() => buildRequest({ bodyFile: path.join(dir, "missing") }), /cannot read .*missing: ENOENT/);
      assert.throws(() => buildRequest({ body: "x", bodyFile: file }), /either --body or --body-file/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
