import test from "node:test";
import assert from "node:assert/strict";
import { calculateAvailableToAssignCents } from "../lib/budget-balance.ts";

test("available to assign includes income and explicit cutover adjustments, then subtracts allocations", () => {
  assert.deepEqual(calculateAvailableToAssignCents([
    { kind: "income", amountCents: 10_000 },
    { kind: "expense", amountCents: 2_000 },
    { kind: "income", amountCents: 99_999, status: "removed" },
  ], [
    { amountCents: 8_500 },
  ], [
    { amountCents: 4_178 },
  ]), { incomeCents: 10_000, allocatedCents: 8_500, adjustmentCents: 4_178, availableCents: 5_678 });
});

test("negative budget adjustments are supported for corrections", () => {
  assert.equal(calculateAvailableToAssignCents([{ kind: "income", amountCents: 10_000 }], [], [{ amountCents: -2_500 }]).availableCents, 7_500);
});
