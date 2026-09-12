import assert from "node:assert/strict";
import test from "node:test";
import { importedReviewDetails, importedReviewTitle, ledgerEntryNoun, supportsBudgetCategory } from "../lib/ledger-entry-types.ts";

test("review language follows the actual ledger entry type", () => {
  assert.equal(ledgerEntryNoun("income"), "income");
  assert.equal(importedReviewTitle("income", "Cash from Steph"), "Review imported income: Cash from Steph");
  assert.match(importedReviewDetails("income", "stale transfer copy"), /deposit is income/i);
  assert.equal(ledgerEntryNoun("transfer_in"), "transfer");
  assert.equal(ledgerEntryNoun("expense"), "transaction");
});

test("only expenses and refunds support budget categories", () => {
  assert.equal(supportsBudgetCategory("expense"), true);
  assert.equal(supportsBudgetCategory("refund"), true);
  for (const kind of ["income", "transfer_in", "transfer_out", "card_payment", "adjustment"]) assert.equal(supportsBudgetCategory(kind), false);
});
