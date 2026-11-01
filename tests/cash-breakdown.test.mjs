import test from "node:test";
import assert from "node:assert/strict";
import { calculateCashBreakdown, dashboardCashBreakdown } from "../lib/cash-breakdown.ts";

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

test("allocated unpaid card purchases explain cash without becoming free money", () => {
  const result = calculateCashBreakdown(10000, 0, [{ id: "food", name: "Food", availableCents: 7000 }], { postedCents: 3000 });
  assert.equal(result.postedCardReserveCents, 3000);
  assert.equal(result.unmatchedCents, 0);
  assert.equal(result.shortfallCents, 0);
  assert.equal(result.plannedCents, 10000);
});

test("card reserves retain the full claim so a real cash deficit stays visible", () => {
  const result = calculateCashBreakdown(9000, 0, [{ id: "food", name: "Food", availableCents: 7000 }], { postedCents: 3000 });
  assert.equal(result.postedCardReserveCents, 3000);
  assert.equal(result.shortfallCents, 1000);
  assert.equal(result.unmatchedCents, 0);
});

const cashPlanFixture = () => ({
  accounts: [{ id: "cash", type: "savings", active: true, name: "Cash", ledgerBalance: 100 }, { id: "card", type: "credit_card", active: true, name: "Card", ledgerBalance: -50 }],
  managedCategories: [{ id: "food", name: "Food", active: true, allocated: 100, available: 50, cardFundingAllocated: 100, cardFundingAvailable: 70 }],
  activity: [
    { id: "posted", accountId: "card", categoryId: "food", description: "Dinner", kind: "expense", status: "posted", pending: false, amount: 30, remainingToPay: 30, date: "2026-10-01" },
    { id: "pending", accountId: "card", categoryId: "food", description: "Pending meal", kind: "expense", status: "pending", pending: true, amount: 20, remainingToPay: 20, date: "2026-10-02" },
  ], payments: [], remainingToBudget: 0,
});

test("cash plan counts category money, posted card reserves, and pending reserves once each", () => {
  const fixture = cashPlanFixture();
  const original = structuredClone(fixture);
  const result = dashboardCashBreakdown(fixture, "2026-10-03");
  assert.equal(result.reservedCents, 5000);
  assert.equal(result.postedCardReserveCents, 3000);
  assert.equal(result.pendingCardReserveCents, 2000);
  assert.equal(result.unmatchedCents, 0);
  assert.equal(result.shortfallCents, 0);
  assert.deepEqual(fixture, original);
});

test("pending card holds reserve only funding left after older posted purchases", () => {
  const fixture = cashPlanFixture();
  Object.assign(fixture.managedCategories[0], { available: -30, cardFundingAvailable: 20 });
  Object.assign(fixture.activity[0], { amount: 80, remainingToPay: 80 });
  Object.assign(fixture.activity[1], { amount: 50, remainingToPay: 50 });
  fixture.accounts[1].ledgerBalance = -130;
  const result = dashboardCashBreakdown(fixture, "2026-10-03");
  assert.equal(result.reservedCents, 0);
  assert.equal(result.postedCardReserveCents, 8000);
  assert.equal(result.pendingCardReserveCents, 2000);
  assert.equal(result.plannedCents, 10000);
  assert.equal(result.unmatchedCents, 0);
});

test("pending refunds and future activity cannot explain away a cash discrepancy", () => {
  const fixture = cashPlanFixture();
  fixture.managedCategories[0].available = 100;
  fixture.activity.push({ id: "pending-refund", accountId: "card", categoryId: "food", kind: "refund", status: "pending", pending: true, amount: 50, remainingToPay: 0, date: "2026-10-02" });
  fixture.activity.push({ id: "future", accountId: "card", categoryId: "food", kind: "expense", status: "pending", pending: true, amount: 50, remainingToPay: 50, date: "2026-11-02" });
  const result = dashboardCashBreakdown(fixture, "2026-10-03");
  assert.equal(result.reservedCents, 5000);
  assert.equal(result.pendingCardReserveCents, 2000);
  assert.equal(result.plannedCents, 10000);
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
