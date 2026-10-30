import assert from "node:assert/strict";
import test from "node:test";
import { calculateCashExpenseFunding, dashboardCashExpenseFunding } from "../lib/cash-expense-funding.ts";

const date = "2026-10-29";
const accounts = [{ id: "cash", type: "checking" }, { id: "savings", type: "savings" }, { id: "card", type: "credit_card" }];
const categories = [{ id: "food", active: true }, { id: "old", active: false }];
const entry = (id, overrides = {}) => ({ id, accountId: "cash", categoryId: "food", kind: "expense", amountCents: 1000, status: "posted", pending: false, effectiveDate: date, ...overrides });
const allocation = (amountCents, effectiveDate = date) => ({ categoryId: "food", amountCents, effectiveDate });

test("cash funding has priority over card spending in a shared category, including partial funding and refunds", () => {
  const transactions = [entry("cash", { amountCents: 10001 }), entry("savings", { accountId: "savings", amountCents: 2000, status: "cleared" }), entry("card", { accountId: "card", amountCents: 50000 }), entry("refund", { kind: "refund", accountId: "card", amountCents: 1001 })];
  const result = calculateCashExpenseFunding(accounts, categories, [allocation(5000)], transactions, date);
  assert.deepEqual(result, { shortfalls: [{ categoryId: "food", cashSpentCents: 12001, amountCents: 6000 }], uncategorizedIds: [] });
  assert.deepEqual(calculateCashExpenseFunding(accounts, categories, [allocation(11000)], transactions, date).shortfalls, []);
});

test("pending, future, void, removed, unknown-account, transfer and card-only entries do not create cash funding needs", () => {
  const ignored = [entry("pending", { pending: true }), entry("pending-status", { status: "pending" }), entry("future", { effectiveDate: "2026-10-30" }), entry("void", { status: "void" }), entry("removed", { status: "removed" }), entry("unknown", { accountId: "missing" }), entry("transfer", { kind: "transfer_out" }), entry("card", { accountId: "card" })];
  assert.deepEqual(calculateCashExpenseFunding(accounts, categories, [], ignored, date), { shortfalls: [], uncategorizedIds: [] });
  const result = calculateCashExpenseFunding(accounts, categories, [allocation(1000, "2026-10-30")], [entry("cash"), entry("pending-refund", { kind: "refund", pending: true })], date);
  assert.equal(result.shortfalls[0].amountCents, 1000);
});

test("uncategorized and inactive-category cash expenses require categorization before funding", () => {
  const result = calculateCashExpenseFunding(accounts, categories, [], [entry("uncategorized", { categoryId: null }), entry("inactive", { categoryId: "old" }), entry("card", { categoryId: null, accountId: "card" })], date);
  assert.deepEqual(result, { shortfalls: [], uncategorizedIds: ["uncategorized", "inactive"] });
});

test("dashboard amounts use exact cents and funding removals remain part of the shortfall", () => {
  const result = dashboardCashExpenseFunding({ managedAccounts: accounts, managedCategories: categories, allocations: [{ categoryId: "food", amount: -0.1, date }], activity: [{ id: "cash", accountId: "cash", categoryId: "food", kind: "expense", amount: 0.2, status: "posted", pending: false, date }] }, date);
  assert.equal(result.shortfalls[0].amountCents, 30);
});
