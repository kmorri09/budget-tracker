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
  assert.equal(result.flex, null);
});

const flexCategories = [
  { id: "fees", name: "Card Fees (Steph)", availableCents: 132_347 },
  { id: "rent", name: "Rent", availableCents: 93_647 },
  { id: "bonus", name: "Bonus + Tax Refund", availableCents: 139_917 },
];

test("the screenshot shortfall uses the Bonus cushion once and leaves other category balances intact", () => {
  const result = calculateCashBreakdown(233_564, -132_347, flexCategories);
  assert.equal(result.shortfallCents, 132_347);
  assert.equal(result.overassignedCents, 132_347);
  assert.deepEqual(result.flex, {
    categoryId: "bonus", categoryName: "Bonus + Tax Refund",
    limitCents: 139_917, neededCents: 132_347, usedCents: 132_347,
    remainingCents: 7_570, excessCents: 0, scaleCents: 139_917,
  });
  assert.equal(result.fundedCategories[0].id, "bonus");
  assert.equal(result.fundedCategories.find(c => c.id === "rent").availableCents, 93_647);
  assert.equal(result.reservedCents, 365_911);
});

test("Bonus stays first even when Rent is larger, without changing the cushion limit", () => {
  const categories = [...flexCategories, { id: "large-rent", name: "Other rent", availableCents: 200_000 }];
  const result = calculateCashBreakdown(565_911, 0, categories);
  assert.equal(result.fundedCategories[0].id, "bonus");
  assert.equal(result.flex.limitCents, 139_917);
  assert.equal(result.flex.remainingCents, 139_917);
  assert.equal(result.flex.neededCents, 0);
  assert.deepEqual(categories.slice(0, 3), flexCategories);
});

test("shortfalls at and beyond the Bonus limit distinguish fully used from overflow", () => {
  const exact = calculateCashBreakdown(225_994, 0, flexCategories);
  assert.equal(exact.flex.remainingCents, 0);
  assert.equal(exact.flex.excessCents, 0);
  const beyond = calculateCashBreakdown(200_000, -132_347, flexCategories);
  assert.equal(beyond.flex.neededCents, 165_911);
  assert.equal(beyond.flex.usedCents, 139_917);
  assert.equal(beyond.flex.excessCents, 25_994);
  assert.equal(beyond.flex.scaleCents, 165_911);
});

test("overassignment beyond the cushion is visible even when recorded cash covers positive categories", () => {
  const result = calculateCashBreakdown(500_000, -160_000, flexCategories);
  assert.equal(result.shortfallCents, 0);
  assert.equal(result.flex.neededCents, 160_000);
  assert.equal(result.flex.excessCents, 20_083);
});

test("a depleted Bonus category cannot supply a positive flex cushion", () => {
  const result = calculateCashBreakdown(100_000, -50_000, [
    { id: "bonus", name: "Bonus and Tax Refund", availableCents: -10_000 },
    { id: "rent", name: "Rent", availableCents: 200_000 },
  ]);
  assert.equal(result.flex.limitCents, 0);
  assert.equal(result.flex.usedCents, 0);
  assert.equal(result.flex.remainingCents, 0);
  assert.equal(result.flex.excessCents, 100_000);
  assert.equal(result.fundedCategories[0].id, "rent");
});
