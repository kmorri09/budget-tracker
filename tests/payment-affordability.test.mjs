import test from "node:test";
import assert from "node:assert/strict";
import { paymentAffordability } from "../lib/payment-affordability.ts";
import { cardPaymentPreview } from "../lib/card-payment-suggestions.ts";
const now = Date.parse("2026-10-30T03:00:00Z");
const cash = (id, ledgerBalance, available = ledgerBalance) => ({ id, name: id, active: true, type: "savings", ledgerBalance, providerAvailableBalance: available, providerBalanceAt: new Date(now).toISOString() });
const category = (id, available) => ({ id, name: id, available, active: true });

test("cash protects all positive allocations without counting a pending withdrawal twice", () => {
  const result = paymentAffordability({ accounts: [cash("savings", 4513.01), cash("checking", 150)], managedCategories: [category("rent", 1400), category("other", 2320.62), category("loan already pending", 0), category("overspent", -100)] }, "savings", now);
  assert.equal(result.cashCents, 466301);
  assert.equal(result.reservedCents, 372062);
  assert.equal(result.affordableCents, 94239);
});

test("source availability and pooled cash both constrain payment size; inactive reserves remain protected", () => {
  const result = paymentAffordability({ accounts: [cash("small", 10), cash("large", 90)], managedCategories: [{ ...category("saved", 30), active: false }] }, "small", now);
  assert.equal(result.affordableCents, 1000);
  assert.equal(result.totalAffordableCents, 7000);
  assert.equal(paymentAffordability({ accounts: [cash("a", 10)], managedCategories: [category("rent", 20)] }, undefined, now).affordableCents, 0);
});

test("category-backed payments do not silently spend money still shown as available to assign", () => {
  const result = paymentAffordability({ accounts: [cash("cash", 4663.01)], managedCategories: [category("other", 3720.62)], remainingToBudget: 419.92 }, undefined, now);
  assert.equal(result.unassignedCents, 41992);
  assert.equal(result.affordableCents, 52247);
});

test("fresh available balances cap the ledger; stale balances fall back to ledger with a warning", () => {
  assert.equal(paymentAffordability({ accounts: [cash("a", 100, 60)], managedCategories: [] }, undefined, now).affordableCents, 6000);
  const stale = { ...cash("a", 80, 100), providerBalanceAt: "2026-10-01T00:00:00Z" };
  const result = paymentAffordability({ accounts: [stale], managedCategories: [] }, undefined, now);
  assert.equal(result.affordableCents, 8000);
  assert.equal(result.needsBankVerification, true);
  assert.equal(paymentAffordability({ accounts: [{ ...stale, providerAvailableBalance: 60 }], managedCategories: [] }, undefined, now).affordableCents, 6000);
});

test("all suggested cards share one cash cap and preserve oldest-first partial payments", () => {
  const accounts = [cash("cash", 100), { id: "a", name: "A", type: "credit_card", active: true }, { id: "b", name: "B", type: "credit_card", active: true }];
  const activity = ["a", "b"].map((accountId, i) => ({ id: accountId, accountId, description: accountId, categoryId: "food", kind: "expense", status: "posted", pending: false, remainingToPay: 50, date: `2026-10-0${i + 1}` }));
  const result = cardPaymentPreview({ accounts, managedCategories: [category("food", 0), category("rent", 25)], activity, payments: [] }, "2026-10-29", "cash", now);
  assert.equal(result.fundedCents, 10000);
  assert.equal(result.suggestedCents, 7500);
  assert.deepEqual(result.suggestions.map(s => s.amountCents), [5000, 2500]);
  assert.equal(result.shortfallCents, 2500);
  assert.equal(result.cashAfterCents, 2500);
});

test("a card with an existing credit or smaller total debt cannot be suggested an overpayment", () => {
  const data = { accounts: [cash("cash", 100), { id: "card", name: "Card", type: "credit_card", active: true, ledgerBalance: 20 }], managedCategories: [category("food", 0)], activity: [{ id: "purchase", accountId: "card", description: "Purchase", categoryId: "food", kind: "expense", status: "posted", pending: false, remainingToPay: 100, date: "2026-10-01" }], payments: [] };
  assert.equal(cardPaymentPreview(data, "2026-10-29", "cash", now).suggestedCents, 0);
  data.accounts[1].ledgerBalance = -30;
  assert.equal(cardPaymentPreview(data, "2026-10-29", "cash", now).suggestedCents, 3000);
});
