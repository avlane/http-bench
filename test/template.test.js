import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileTemplate, templateTarget } from "../src/template.js";

describe("compileTemplate", () => {
  it("leaves text without placeholders alone", () => {
    const template = compileTemplate("plain {text} with { braces }");
    assert.equal(template.dynamic, false);
    assert.equal(template.render(1), "plain {text} with { braces }");
  });

  it("fills in the request number", () => {
    const template = compileTemplate("/items/{{i}}?n={{ i }}");
    assert.equal(template.dynamic, true);
    assert.equal(template.render(7), "/items/7?n=7");
    assert.equal(template.render(8), "/items/8?n=8");
  });

  it("generates uuids, timestamps and random numbers", () => {
    const uuid = compileTemplate("{{uuid}}").render(1);
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(compileTemplate("{{uuid}}").render(1), uuid);
    const before = Date.now();
    const stamp = Number(compileTemplate("{{timestamp}}").render(1));
    assert.ok(stamp >= before && stamp <= Date.now());
    const random = compileTemplate("{{rand:5-7}}");
    const seen = new Set(Array.from({ length: 200 }, () => random.render(1)));
    assert.deepEqual([...seen].sort(), ["5", "6", "7"]);
    assert.equal(compileTemplate("{{rand:-3--3}}").render(1), "-3");
  });

  it("reads environment variables once, when compiled", () => {
    const env = { TOKEN: "abc" };
    const template = compileTemplate("Bearer {{env:TOKEN}}", { env });
    env.TOKEN = "changed";
    assert.equal(template.render(1), "Bearer abc");
  });

  it("encodes substituted values when asked to", () => {
    const template = compileTemplate("/q/{{env:Q}}", { env: { Q: "a b&c" }, encode: encodeURIComponent });
    assert.equal(template.render(1), "/q/a%20b%26c");
  });

  it("rejects what it cannot fill in", () => {
    assert.throws(() => compileTemplate("{{nope}}"), /unknown placeholder \{\{nope\}\}/);
    assert.throws(() => compileTemplate("{{env:MISSING_VAR}}", { env: {} }), /environment variable MISSING_VAR is not set/);
    assert.throws(() => compileTemplate("{{rand:9-1}}"), /range is empty/);
    assert.throws(() => compileTemplate("{{env:bad-name}}"), /unknown placeholder/);
  });
});

describe("templateTarget", () => {
  const target = (extra) => ({ url: "http://h.test/items", method: "GET", headers: new Headers(), ...extra });

  it("returns targets without placeholders unchanged", () => {
    const plain = target({ body: "plain" });
    assert.equal(templateTarget(plain), plain);
  });

  it("finds placeholders in URLs even though new URL() escaped them", () => {
    const templated = templateTarget(target({ url: new URL("http://h.test/items/{{i}}?id={{uuid}}&r={{rand:1-9}}").href }));
    const request = templated.render(12);
    assert.match(request.url, /^http:\/\/h\.test\/items\/12\?id=[0-9a-f-]{36}&r=[1-9]$/);
  });

  it("fills in header values and text bodies", () => {
    const headers = new Headers({ "x-request": "req-{{i}}", "x-fixed": "same" });
    const request = templateTarget(target({ method: "POST", headers, body: '{"n": {{i}}}' })).render(3);
    assert.equal(request.headers.get("x-request"), "req-3");
    assert.equal(request.headers.get("x-fixed"), "same");
    assert.equal(request.body, '{"n": 3}');
    assert.equal(request.method, "POST");
  });

  it("does not touch binary bodies", () => {
    const body = Buffer.from("{{i}}");
    const templated = templateTarget(target({ method: "POST", body, headers: new Headers({ a: "{{i}}" }) }));
    assert.equal(templated.render(2).body, body);
  });

  it("encodes environment values put into the URL", () => {
    const templated = templateTarget(target({ url: new URL("http://h.test/{{env:SEG}}").href }), { env: { SEG: "a/b c" } });
    assert.equal(templated.render(1).url, "http://h.test/a%2Fb%20c");
  });

  it("fails at once if the rendered URL is not valid", () => {
    assert.throws(() => templateTarget({ url: "{{uuid}}", method: "GET", headers: new Headers() }), /Invalid URL/);
  });
});
