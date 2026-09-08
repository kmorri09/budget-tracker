import test from "node:test";
import assert from "node:assert/strict";
import { accountType, findLedgerDuplicate, inferTransactionKind, mockProviderAccounts, syncCutoverDate, toNormalized } from "../lib/bank-sync-core.ts";
import { decryptProviderToken, encryptProviderToken } from "../lib/provider-crypto.ts";

test("provider tokens round-trip through authenticated encryption", () => {
  const previous = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-key-with-enough-entropy-for-a-fixture";
  try {
    const encrypted = encryptProviderToken("access-sandbox-token");
    assert.notEqual(encrypted, "access-sandbox-token");
    assert.equal(decryptProviderToken(encrypted), "access-sandbox-token");
    const parts = encrypted.split(".");
    parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
    assert.throws(() => decryptProviderToken(parts.join(".")));
  } finally {
    if (previous === undefined) delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    else process.env.PLAID_TOKEN_ENCRYPTION_KEY = previous;
  }
});

test("provider account types preserve credit-card versus cash semantics", () => {
  const [cash, card] = mockProviderAccounts();
  assert.equal(accountType(cash), "checking");
  assert.equal(accountType(card), "credit_card");
});

test("transfer-like provider activity never becomes budget spending", () => {
  assert.equal(inferTransactionKind({ transaction_id: "t1", account_id: "a", amount: 25, date: "2026-09-08", name: "AUTOPAY CREDIT CARD", pending: false }), "transfer_out");
  assert.equal(inferTransactionKind({ transaction_id: "t2", account_id: "a", amount: -25, date: "2026-09-08", name: "Transfer from savings", pending: false }), "transfer_in");
  assert.equal(inferTransactionKind({ transaction_id: "t3", account_id: "a", amount: 25, date: "2026-09-08", name: "Coffee shop", pending: false }), "expense");
  assert.equal(toNormalized({ transaction_id: "t4", account_id: "a", amount: 4.75, date: "2026-09-08", name: "Coffee shop", pending: true }).amountCents, 475);
});

test("exact ledger matches merge despite different bank descriptions", () => {
  const normalized = toNormalized({ transaction_id: "payroll", account_id: "remote", amount: -4193.29, date: "2026-09-02", name: "MITSUBISHI ELECT", pending: false });
  const match = findLedgerDuplicate(normalized, "sofi", [
    { id: "manual-paycheck", accountId: "sofi", amountCents: 419329, kind: "income", effectiveDate: "2026-09-02", description: "paycheck", source: "notion_import", status: "posted", providerTransactionId: "notion:paycheck" },
    { id: "other-account", accountId: "checking", amountCents: 419329, kind: "income", effectiveDate: "2026-09-02", description: "paycheck", source: "manual", status: "posted", providerTransactionId: null },
  ]);
  assert.equal(match?.id, "manual-paycheck");
  assert.equal(syncCutoverDate(new Date("2026-09-08T12:00:00Z")), "2026-09-01");
});

test("ambiguous repeated amounts are not automatically merged", () => {
  const normalized = toNormalized({ transaction_id: "coffee", account_id: "remote", amount: 4.75, date: "2026-09-02", name: "Coffee", pending: false });
  const repeated = ["one", "two"].map(id => ({ id, accountId: "sofi", amountCents: 475, kind: "expense", effectiveDate: "2026-09-02", description: "Coffee", source: "manual", status: "posted", providerTransactionId: null }));
  assert.equal(findLedgerDuplicate(normalized, "sofi", repeated), null);
});
