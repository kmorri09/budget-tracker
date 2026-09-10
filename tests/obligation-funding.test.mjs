import test from "node:test";
import assert from "node:assert/strict";
import { calculateObligationFunding } from "../lib/obligation-funding.ts";
import { isObligationCovered } from "../lib/obligation-status.ts";

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
