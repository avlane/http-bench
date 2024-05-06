import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDuration } from "../src/duration.js";

describe("parseDuration", () => {
  it("understands milliseconds, seconds, minutes and hours", () => {
    assert.equal(parseDuration("500ms"), 500);
    assert.equal(parseDuration("2s"), 2000);
    assert.equal(parseDuration("1.5s"), 1500);
    assert.equal(parseDuration("3m"), 180000);
    assert.equal(parseDuration("1h"), 3600000);
    assert.equal(parseDuration(" 10s "), 10000);
  });

  it("adds up several parts", () => {
    assert.equal(parseDuration("1m30s"), 90000);
    assert.equal(parseDuration("1h1m1s1ms"), 3661001);
  });

  it("insists on a unit and rejects anything else", () => {
    for (const bad of ["", "10", "s", "1x", "1 s", "-5s", "1s2", "ten seconds", "1.s", "1s 2s"]) {
      assert.throws(() => parseDuration(bad), /invalid duration/, JSON.stringify(bad));
    }
  });
});
