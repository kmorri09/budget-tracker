import test from "node:test";
import assert from "node:assert/strict";
import { calculateCategoryBalance, categoryReconciliationDeltaCents } from "../lib/category-balance.ts";

test("rolling category balance includes all allocations, expenses, and refunds", () => {
  const balance = calculateCategoryBalance("food", [
    { categoryId: "food", amountCents: 10_000 },
    { categoryId: "food", amountCents: -1_000 },
    { categoryId: "travel", amountCents: 50_000 },
  ], [
    { categoryId: "food", kind: "expense", amountCents: 2_500 },
    { categoryId: "food", kind: "refund", amountCents: 400 },
    { categoryId: "food", kind: "income", amountCents: 90_000 },
    { categoryId: "travel", kind: "expense", amountCents: 20_000 },
  ]);
  assert.deepEqual(balance, { allocatedCents: 9_000, spendingCents: 2_500, refundCents: 400, availableCents: 6_900 });
});

test("reconciliation records only the delta needed to reach the desired balance", () => {
  assert.equal(categoryReconciliationDeltaCents(75.94, -20_00), 9_594);
  assert.equal(categoryReconciliationDeltaCents(-10.25, 500), -1_525);
  assert.equal(categoryReconciliationDeltaCents(69, 6_900), 0);
});
