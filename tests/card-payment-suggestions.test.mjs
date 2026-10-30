import test from "node:test";
import assert from "node:assert/strict";
import { suggestCardPayments } from "../lib/card-payment-suggestions.ts";

const card = (id, name = id) => ({ id, name, type: "credit_card", active: true });
const category = (id, available) => ({ id, name: id, available, allocated: 1000 });
const charge = (id, accountId, categoryId, remainingToPay = 50, date = "2026-09-01") => ({ id, description: id, kind: "expense", status: "posted", pending: false, date, accountId, categoryId, remainingToPay });
const preview = (accounts, managedCategories, activity, payments = []) => suggestCardPayments({ accounts, managedCategories, activity, payments }, "2026-09-20");

test("fully funded charges can be suggested in full", () => {
  const [suggestion] = preview([card("hyatt")], [category("Grocery", 0)], [charge("groceries", "hyatt", "Grocery")]);
  assert.equal(suggestion.amountCents, 5_000);
  assert.deepEqual(suggestion.applications.map(item => [item.transactionId, item.amountCents]), [["groceries", 5_000]]);
});

test("an underfunded category suggests only the two charges its funding covers", () => {
  const charges = Array.from({ length: 5 }, (_, index) => charge(`charge-${index + 1}`, "hyatt", "Grocery", 50, `2026-09-0${index + 1}`));
  const [suggestion] = preview([card("hyatt")], [category("Grocery", -150)], charges);
  assert.equal(suggestion.amountCents, 10_000);
  assert.deepEqual(suggestion.applications.map(item => item.transactionId), ["charge-1", "charge-2"]);
});

test("shared category funding is used once across cards and may cover a partial charge", () => {
  const suggestions = preview([card("a"), card("b")], [category("Grocery", -25)], [
    charge("first", "a", "Grocery", 50, "2026-09-01"),
    charge("second", "b", "Grocery", 50, "2026-09-02"),
  ]);
  assert.equal(suggestions.reduce((sum, item) => sum + item.amountCents, 0), 7_500);
  assert.deepEqual(suggestions.map(item => item.cardId), ["a", "b"]);
  assert.deepEqual(suggestions.map(item => item.applications[0].amountCents), [5_000, 2_500]);
});

test("already paid, pending, future and uncategorized charges are excluded", () => {
  const suggestions = preview([card("a")], [category("Grocery", 0)], [
    charge("paid", "a", "Grocery", 0),
    { ...charge("pending", "a", "Grocery"), pending: true },
    charge("future", "a", "Grocery", 50, "2026-09-21"),
    charge("uncategorized", "a", null),
  ]);
  assert.deepEqual(suggestions, []);
});

test("unapplied card payments reduce the amount suggested for new payments", () => {
  const suggestions = preview([card("a")], [category("Grocery", -50)], [
    charge("first", "a", "Grocery", 50, "2026-09-01"),
    charge("second", "a", "Grocery", 50, "2026-09-02"),
  ], [{ toAccountId: "a", date: "2026-09-05", remaining: 50, editable: true }]);
  assert.deepEqual(suggestions, []);
});

test("an unmatched refund cannot create apparent cash funding in an overspent category", () => {
  const data = [charge("old-purchases", "a", "Fun (Steph)", 1010.44)];
  assert.equal(preview([card("a")], [category("Fun (Steph)", -964.99)], data)[0].amountCents, 4545);
  assert.deepEqual(preview([card("a")], [{ ...category("Fun (Steph)", -964.99), unmatchedRefunds: 66.30 }], data), []);
});

test("a positive balance or unpaid charge cannot substitute for actual allocated money", () => {
  const charges = [charge("purchase", "a", "Food", 50)];
  for (const allocated of [0, -10, undefined]) {
    assert.deepEqual(preview([card("a")], [{ ...category("Food", 50), allocated }], charges), []);
  }
  assert.equal(preview([card("a")], [{ ...category("Food", 0), allocated: 20 }], charges)[0].amountCents, 2000);
});

test("funding is limited to effective allocations even when the displayed balance includes future funding", () => {
  const charges = [charge("purchase", "a", "Food", 50)];
  const categories = [{ ...category("Food", 1000), allocated: 1000, cardFundingAllocated: 20, cardFundingAvailable: -30 }];
  assert.equal(preview([card("a")], categories, charges)[0].amountCents, 2000);
  categories[0].cardFundingAvailable = -50;
  assert.deepEqual(preview([card("a")], categories, charges), []);
});
