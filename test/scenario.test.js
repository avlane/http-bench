import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { loadRequestsFile } from "../src/scenario.js";

const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function file(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "http-bench-"));
  dirs.push(dir);
  const name = path.join(dir, "requests.json");
  fs.writeFileSync(name, text);
  return name;
}

const base = new URL("http://api.test:8080/v1/");

describe("loadRequestsFile", () => {
  it("reads a JSON array and resolves URLs against the base", () => {
    const targets = loadRequestsFile(file('[{"url": "items"}, {"url": "/health"}, {"url": "https://other.test/x"}, {}]'), { baseUrl: base });
    assert.deepEqual(targets.map((t) => [t.method, t.url]), [
      ["GET", "http://api.test:8080/v1/items"],
      ["GET", "http://api.test:8080/health"],
      ["GET", "https://other.test/x"],
      ["GET", "http://api.test:8080/v1/"],
    ]);
  });

  it("reads JSON Lines and skips blank lines", () => {
    const targets = loadRequestsFile(file('{"url": "/a"}\n\n{"url": "/b", "method": "delete"}\n'), { baseUrl: base });
    assert.deepEqual(targets.map((t) => [t.method, new URL(t.url).pathname]), [["GET", "/a"], ["DELETE", "/b"]]);
  });

  it("serialises json bodies and sets the content type unless one is given", () => {
    const [plain, typed] = loadRequestsFile(file('[{"method": "POST", "json": {"a": [1, 2]}}, {"method": "POST", "json": {}, "headers": {"content-type": "application/vnd.api+json"}}]'), { baseUrl: base });
    assert.equal(plain.body, '{"a":[1,2]}');
    assert.equal(plain.headers.get("content-type"), "application/json");
    assert.equal(typed.headers.get("content-type"), "application/vnd.api+json");
  });

  it("raw bodies are sent as they are, and a body without a method means POST", () => {
    const [target] = loadRequestsFile(file('[{"body": "a=1&b=2"}]'), { baseUrl: base });
    assert.deepEqual([target.method, target.body], ["POST", "a=1&b=2"]);
  });

  it("applies command line headers to every entry, but an entry can replace one", () => {
    const targets = loadRequestsFile(file('[{"url": "/a"}, {"url": "/b", "headers": {"X-Token": "own"}}]'), {
      baseUrl: base, headers: ["X-Token: shared", "Accept: text/plain"], userAgent: "http-bench/9",
    });
    assert.equal(targets[0].headers.get("x-token"), "shared");
    assert.equal(targets[1].headers.get("x-token"), "own");
    assert.equal(targets[1].headers.get("accept"), "text/plain");
    assert.equal(targets[1].headers.get("user-agent"), "http-bench/9");
  });

  it("uses the command line method for entries without one", () => {
    const [a, b] = loadRequestsFile(file('[{"url": "/a"}, {"url": "/b", "method": "GET"}]'), { baseUrl: base, method: "head" });
    assert.deepEqual([a.method, b.method], ["HEAD", "GET"]);
  });

  it("points at the entry or line that is wrong", () => {
    const cases = [
      ['[{"url": "/a", "colour": 1}]', /entry 1: unknown field 'colour'/],
      ['[1]', /entry 1: expected an object/],
      ['[{"body": "x", "json": 1}]', /entry 1: use either body or json/],
      ['[{"url": "/a", "method": "GET", "body": "x"}]', /entry 1: GET requests cannot have a body/],
      ['[{"url": "ftp://x/y"}]', /unsupported protocol ftp:/],
      ['[{"url": "/a"}, {"headers": {"bad name": "x"}}]', /entry 2: invalid header/],
      ['{"url": "/a"}\nnot json\n', /requests\.json:2: invalid JSON/],
      ["[", /invalid JSON/],
      ["[]", /contains no requests/],
      ["", /contains no requests/],
    ];
    for (const [text, pattern] of cases) assert.throws(() => loadRequestsFile(file(text), { baseUrl: base }), pattern, text);
  });

  it("relative URLs need a base URL", () => {
    assert.throws(() => loadRequestsFile(file('[{"url": "/a"}]'), {}), /not a valid URL \(give a base URL or use absolute URLs\)/);
    assert.equal(loadRequestsFile(file('[{"url": "http://x.test/a"}]'), {})[0].url, "http://x.test/a");
  });

  it("reports unreadable files", () => {
    assert.throws(() => loadRequestsFile("/no/such/requests.json", {}), /cannot read .*: ENOENT/);
  });
});
