import test from "node:test";
import assert from "node:assert/strict";
import { calculateCashBreakdown } from "../lib/cash-breakdown.ts";

test("a fully explained bank balance divides into category reserves and money to assign", () => {
  const result = calculateCashBreakdown(500_000, 100_000, [
    { id: "rent", name: "Rent", availableCents: 260_000 },
    { id: "other", name: "Other", availableCents: 140_000 },
  ]);
  assert.equal(result.reservedCents, 400_000);
  assert.equal(result.unassignedCents, 100_000);
  assert.equal(result.unmatchedCents, 0);
  assert.equal(result.shortfallCents, 0);
  assert.equal(result.scaleCents, 500_000);
});

test("cash beyond the budget plan is shown separately, not called free to assign", () => {
  const result = calculateCashBreakdown(500_000, 100_000, [{ id: "rent", name: "Rent", availableCents: 260_000 }]);
  assert.equal(result.unmatchedCents, 140_000);
  assert.equal(result.unassignedCents, 100_000);
});

test("reservations beyond cash retain their full amounts and report the gap", () => {
  const result = calculateCashBreakdown(300_000, 50_000, [
    { id: "rent", name: "Rent", availableCents: 260_000 },
    { id: "groceries", name: "Groceries", availableCents: 70_000 },
    { id: "dining", name: "Dining", availableCents: -10_000 },
  ]);
  assert.equal(result.reservedCents, 330_000);
  assert.equal(result.unassignedCents, 50_000);
  assert.equal(result.shortfallCents, 80_000);
  assert.equal(result.unmatchedCents, 0);
  assert.equal(result.overspentCents, 10_000);
  assert.equal(result.scaleCents, 380_000);
});

test("negative unassigned budget never appears as cash available to assign", () => {
  const result = calculateCashBreakdown(100_000, -20_000, []);
  assert.equal(result.unassignedCents, 0);
  assert.equal(result.overassignedCents, 20_000);
  assert.equal(result.unmatchedCents, 100_000);
});
