import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sparkline } from "../src/report.js";

describe("sparkline", () => {
  it("scales every value against the largest", () => {
    assert.equal(sparkline([0, 50, 100]), "▁▅█");
    assert.equal(sparkline([10, 10, 10]), "███");
    assert.equal(sparkline([1, 2, 4, 8]).length, 4);
  });

  it("copes with all zeros and a single value", () => {
    assert.equal(sparkline([0, 0]), "▁▁");
    assert.equal(sparkline([5]), "█");
  });
});
