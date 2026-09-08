import test from "node:test";
import assert from "node:assert/strict";
import { accountType, inferTransactionKind, mockProviderAccounts, toNormalized } from "../lib/bank-sync-core.ts";
import { decryptProviderToken, encryptProviderToken } from "../lib/provider-crypto.ts";

test("provider tokens round-trip through authenticated encryption", () => {
  const previous = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-key-with-enough-entropy-for-a-fixture";
  try {
    const encrypted = encryptProviderToken("access-sandbox-token");
    assert.notEqual(encrypted, "access-sandbox-token");
    assert.equal(decryptProviderToken(encrypted), "access-sandbox-token");
    assert.throws(() => decryptProviderToken(`${encrypted.slice(0, -1)}x`));
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
