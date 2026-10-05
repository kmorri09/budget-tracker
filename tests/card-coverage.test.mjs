import assert from "node:assert/strict";
import test from "node:test";
import { coverageReconciliation } from "../lib/card-coverage.ts";

test("mark paid adds only the remaining uncovered amount", () => {
  assert.deepEqual(coverageReconciliation(42_266, 10_000, "paid"), { currentCents: 10_000, desiredCents: 42_266, deltaCents: 32_266 });
});

test("mark unpaid reverses all current coverage", () => {
  assert.deepEqual(coverageReconciliation(42_266, 42_266, "unpaid"), { currentCents: 42_266, desiredCents: 0, deltaCents: -42_266 });
});

test("coverage reconciliation removes legacy over-coverage and ignores negative totals", () => {
  assert.deepEqual(coverageReconciliation(5_000, 8_000, "paid"), { currentCents: 8_000, desiredCents: 5_000, deltaCents: -3_000 });
  assert.deepEqual(coverageReconciliation(5_000, -1_000, "unpaid"), { currentCents: 0, desiredCents: 0, deltaCents: 0 });
});
