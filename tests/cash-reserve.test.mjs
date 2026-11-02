import test from "node:test";
import assert from "node:assert/strict";
import { calculateCashReserves } from "../lib/cash-reserve.ts";
import { suggestCardPayments } from "../lib/card-payment-suggestions.ts";
import { calculateObligationFunding } from "../lib/obligation-funding.ts";

const stamp = n => new Date(`2026-11-01T12:00:0${n}Z`);
const change = (id, categoryId, amountCents, n) => ({ id, categoryId, amountCents, effectiveDate: "2026-11-01", createdAt: stamp(n) });
const expense = (id, categoryId, accountId, amountCents, n, status = "posted") => ({ id, categoryId, accountId, amountCents, kind: "expense", effectiveDate: "2026-11-01", createdAt: stamp(n), status });

test("cash expenses consume only their category's reserve; card purchases do not", () => {
  const changes = [change("a", "insurance", 10500, 1), change("b", "utilities", 7100, 1)];
  const rows = [expense("c", "insurance", "bank", 2500, 2), expense("d", "insurance", "card", 9000, 3)];
  const result = calculateCashReserves(changes, rows, new Set(["bank"]), "2026-11-01");
  assert.equal(result.get("insurance"), 8000);
  assert.equal(result.get("utilities"), 7100);
  assert.equal(calculateCashReserves(changes, [{ ...rows[0], status: "removed" }], new Set(["bank"]), "2026-11-01").get("insurance"), 10500);
});

test("a cash reserve is unavailable to card payment suggestions even with a negative category balance", () => {
  const dashboard = {
    accounts: [{ id: "card", name: "Card", type: "credit_card", active: true, ledgerBalance: -112.89 }],
    managedCategories: [{ id: "insurance", name: "Insurance", allocated: 105, available: -7.89, cashReserve: 105 }],
    activity: [{ id: "purchase", accountId: "card", categoryId: "insurance", kind: "expense", status: "posted", pending: false, date: "2026-11-01", remainingToPay: 112.89, description: "Insurance" }],
    payments: [],
  };
  assert.deepEqual(suggestCardPayments(dashboard, "2026-11-01"), []);
});

test("funding uses existing free money and retains an existing cash reserve despite a negative category balance", () => {
  const bills = [{ id: "bill", categoryId: "insurance", name: "Policy", amountCents: 10500 }];
  const [funded] = calculateObligationFunding(bills, [{ id: "insurance", name: "Insurance", availableCents: -789, cashReserveCents: 10500 }]);
  assert.equal(funded.reserveCents, 0);
  assert.equal(funded.allocationCents, 0);
  const [partial] = calculateObligationFunding(bills, [{ id: "insurance", name: "Insurance", availableCents: 8000, cashReserveCents: 5000 }]);
  assert.equal(partial.reserveCents, 5500);
  assert.equal(partial.allocationCents, 2500);
});
