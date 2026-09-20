import test from "node:test";
import assert from "node:assert/strict";
import { calculateObligationFunding } from "../lib/obligation-funding.ts";
import { isObligationCovered, nextOccurrence, planObligations } from "../lib/obligation-status.ts";

test("upcoming obligations allocate only each category's combined shortfall", () => {
  assert.deepEqual(calculateObligationFunding([
    { id: "one", categoryId: "utilities", name: "Power", amountCents: 7_500 },
    { id: "two", categoryId: "utilities", name: "Water", amountCents: 5_000 },
    { id: "three", categoryId: "rent", name: "Rent", amountCents: 260_000 },
  ], [
    { id: "utilities", name: "Utilities", availableCents: 4_000 },
    { id: "rent", name: "Rent", availableCents: 260_000 },
  ]).map(group => ({ category: group.category, allocationCents: group.allocationCents })), [
    { category: "Utilities", allocationCents: 8_500 },
    { category: "Rent", allocationCents: 0 },
  ]);
});

test("an overspent category is restored before its obligation is funded", () => {
  const [group] = calculateObligationFunding([{ id: "one", categoryId: "travel", name: "Hotel", amountCents: 20_000 }], [{ id: "travel", name: "Travel", availableCents: -5_000 }]);
  assert.equal(group.allocationCents, 25_000);
});

test("matching past payments cover obligations without manual cleanup", () => {
  const obligation = { name: "Hyatt Payment", amountCents: 19_000, dueDate: "2026-09-05", accountId: "card" };
  assert.equal(isObligationCovered(obligation, [{ description: "Hyatt Payment", amountCents: 19_000, effectiveDate: "2026-09-07", fromAccountId: "cash", toAccountId: "card" }], "2026-09-09"), true);
  assert.equal(isObligationCovered(obligation, [{ description: "Other payment", amountCents: 19_000, effectiveDate: "2026-09-07", fromAccountId: "cash", toAccountId: "card" }], "2026-09-09"), false);
});

test("recurring obligations learn posted charge timing and amount from history", () => {
  const obligation = { id: "hyatt", name: "Hyatt Payment", amountCents: 19_000, dueDate: "2026-09-05", accountId: "sofi", cadence: "Monthly" };
  const candidates = [
    { id: "aug", type: "payment", description: "Autopay Hyatt", amountCents: 18_500, effectiveDate: "2026-08-07", fromAccountId: "sofi", toAccountId: "hyatt-card" },
    { id: "sep", type: "payment", description: "Autopay Hyatt", amountCents: 19_500, effectiveDate: "2026-09-07", fromAccountId: "sofi", toAccountId: "hyatt-card" },
  ];
  const plan = planObligations([obligation], candidates, [], "2026-09-20").get("hyatt");
  assert.equal(plan.nextChargeDate, "2026-10-07");
  assert.equal(plan.expectedAmountCents, 19_500);
  assert.equal(plan.previousCharge.amountCents, 18_500);
  assert.equal(plan.covered, false);
  assert.equal(plan.amountSource, "observed");
});

test("uncertain amount changes require confirmation and dismissals persist", () => {
  const obligation = { id: "hyatt", name: "Hyatt Payment", amountCents: 19_000, dueDate: "2026-09-05", accountId: "sofi", cadence: "Monthly" };
  const candidate = { id: "sep", type: "transaction", description: "Hyatt credit card", amountCents: 24_000, effectiveDate: "2026-09-07", accountId: "sofi" };
  const pending = planObligations([obligation], [candidate], [], "2026-09-20").get("hyatt");
  assert.equal(pending.lastCharge, null);
  assert.equal(pending.suggestion.id, "sep");
  assert.equal(planObligations([obligation], [candidate], [{ obligationId: "hyatt", candidateType: "transaction", candidateId: "sep", status: "confirmed" }], "2026-09-20").get("hyatt").expectedAmountCents, 24_000);
  assert.equal(planObligations([obligation], [candidate], [{ obligationId: "hyatt", candidateType: "transaction", candidateId: "sep", status: "dismissed" }], "2026-09-20").get("hyatt").suggestion, null);
});

test("one charge cannot satisfy two obligations and duplicate cycle charges require review", () => {
  const base = { amountCents: 19_000, dueDate: "2026-09-05", accountId: "sofi", cadence: "Monthly" };
  const charge = { id: "sep", type: "transaction", description: "Hyatt credit card", amountCents: 19_000, effectiveDate: "2026-09-07", accountId: "sofi" };
  const competing = planObligations([{ ...base, id: "a", name: "Hyatt Payment" }, { ...base, id: "b", name: "Hyatt Card" }], [charge], [], "2026-09-20");
  assert.equal(competing.get("a").lastCharge, null);
  assert.equal(competing.get("b").lastCharge, null);
  assert.ok(competing.get("a").suggestion);
  const duplicate = planObligations([{ ...base, id: "a", name: "Hyatt Payment" }], [charge, { ...charge, id: "sep-2", effectiveDate: "2026-09-08" }], [], "2026-09-20").get("a");
  assert.equal(duplicate.lastCharge, null);
  assert.ok(duplicate.suggestion);
});

test("month end schedules stay at month end when needed", () => {
  assert.equal(nextOccurrence("2026-01-31", "Monthly", "2026-02-01"), "2026-02-28");
  assert.equal(nextOccurrence("2026-01-31", "Monthly", "2026-03-01"), "2026-03-31");
});

test("shared merchant names need their distinguishing word for automatic matching", () => {
  const obligations = [
    { id: "whole", name: "Prudential Whole", amountCents: 10_500, dueDate: "2026-09-15", accountId: "cash", cadence: "Monthly" },
    { id: "term", name: "Prudential Term", amountCents: 10_500, dueDate: "2026-09-15", accountId: "cash", cadence: "Monthly" },
  ];
  const candidate = { id: "charge", type: "transaction", description: "Prudential Term", amountCents: 10_500, effectiveDate: "2026-09-15", accountId: "cash" };
  const plans = planObligations(obligations, [candidate], [], "2026-09-20");
  assert.equal(plans.get("term").lastCharge.id, "charge");
  assert.equal(plans.get("whole").lastCharge, null);
});
