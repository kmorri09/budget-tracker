import test from "node:test";
import assert from "node:assert/strict";
import { calculateCardPurchaseCoverage, matchCardRefunds } from "../lib/card-refunds.ts";

const row = (id, kind, amountCents, extra = {}) => ({ id, kind, amountCents, accountId: "amex", categoryId: "travel", description: "American Airlines", effectiveDate: kind === "refund" ? "2026-10-08" : "2026-09-18", status: "posted", pending: false, ...extra });
const calculate = (rows, decisions = [], payments = [], date = "2026-10-29") => calculateCardPurchaseCoverage(rows, new Set(["amex", "other-card"]), decisions, payments, date);

test("existing airline refunds clear the $140.01 purchase and partially refund the $558.39 purchase", () => {
  const result = calculate([row("small", "expense", 14001), row("large", "expense", 55839), row("full", "refund", 14001), row("partial", "refund", 11919)]);
  assert.equal(result.coverage.get("small").status, "Refunded");
  assert.equal(result.coverage.get("small").remainingCents, 0);
  assert.equal(result.coverage.get("large").remainingCents, 43920);
  assert.equal(result.coverage.get("large").status, "Partially refunded");
  assert.equal(result.refunds.links.reduce((n, l) => n + l.amountCents, 0), 25920);
});

test("duplicate amounts and competing refunds require review instead of arbitrary matching", () => {
  const ambiguous = calculate([row("a", "expense", 100), row("b", "expense", 100), row("r", "refund", 100)]);
  assert.equal(ambiguous.refunds.links.length, 0);
  assert.equal(ambiguous.refunds.refunds[0].candidates.length, 2);
  const competing = calculate([row("a", "expense", 100), row("r1", "refund", 100), row("r2", "refund", 100)]);
  assert.equal(competing.refunds.links.length, 0);
  // Unmatched credits still reduce the actual amount owed on this card.
  assert.equal(competing.coverage.get("a").remainingCents, 0);
  assert.equal(competing.creditByCard.get("amex"), 100);
});

test("confirmed partial matches respect their chosen amount and dismissed pairs stay dismissed", () => {
  const rows = [row("a", "expense", 200), row("r", "refund", 100)];
  const confirmed = calculate(rows, [{ refundId: "r", transactionId: "a", amountCents: 40, status: "confirmed" }]);
  assert.equal(confirmed.refunds.links[0].amountCents, 40);
  assert.equal(confirmed.refunds.refunds[0].remainingCents, 60);
  assert.equal(calculate(rows, [{ refundId: "r", transactionId: "a", amountCents: 100, status: "dismissed" }]).refunds.links.length, 0);
});

test("a refund of an already-paid purchase becomes card credit without undoing the payment", () => {
  const result = calculate([row("paid", "expense", 100), row("new", "expense", 150, { description: "Other merchant", effectiveDate: "2026-10-10" }), row("r", "refund", 100)], [], [{ transactionId: "paid", amountCents: 100 }]);
  assert.equal(result.coverage.get("paid").paidCents, 100);
  assert.equal(result.coverage.get("paid").status, "Refunded");
  assert.equal(result.coverage.get("new").cardCreditCents, 100);
  assert.equal(result.coverage.get("new").remainingCents, 50);
});

test("removed, pending, future and wrong-card refunds cannot cover a purchase", () => {
  for (const extra of [{ status: "removed" }, { pending: true }, { effectiveDate: "2026-11-01" }, { accountId: "other-card" }]) {
    const result = calculate([row("a", "expense", 100), row("r", "refund", 100, extra)]);
    assert.equal(result.coverage.get("a").remainingCents, 100);
  }
});

test("editing/deleting a matched transaction recalculates links and never over-refunds", () => {
  const decision = [{ refundId: "r", transactionId: "a", amountCents: 100, status: "confirmed" }];
  const result = calculate([row("a", "expense", 60), row("r", "refund", 100)], decision);
  assert.equal(result.refunds.links[0].amountCents, 60);
  assert.equal(result.creditByCard.get("amex"), 40);
  assert.equal(calculate([row("a", "expense", 100), row("r", "refund", 100, { status: "removed" })], decision).coverage.get("a").remainingCents, 100);
  assert.equal(matchCardRefunds([row("a", "expense", 100), row("r", "refund", 100)], new Set(["amex"]), [], "2026-10-01").links.length, 0);
});
