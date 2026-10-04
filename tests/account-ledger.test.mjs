import assert from "node:assert/strict";
import test from "node:test";
import { calculateAccountLedgerCents } from "../lib/account-ledger.ts";
import { linkedBankDifferences, nearbyPaymentBankActivity, possibleLedgerDuplicates } from "../lib/account-reconciliation.ts";

test("a card purchase and its payment deduct cash once and settle card debt", () => {
  const hotel = { kind: "expense", amountCents: 42_266, status: "posted" };
  const payments = [{ fromAccountId: "savings", toAccountId: "card", amountCents: 42_266 }];
  assert.equal(calculateAccountLedgerCents("savings", 100_000, [], payments), 57_734);
  assert.equal(calculateAccountLedgerCents("card", 0, [hotel], payments), 0);
});

test("converted bank transfer legs are excluded so the payment is not counted twice", () => {
  const payments = [{ fromAccountId: "savings", toAccountId: "card", amountCents: 42_266 }];
  assert.equal(calculateAccountLedgerCents("savings", 100_000, [
    { kind: "transfer_out", amountCents: 42_266, status: "removed" },
  ], payments), 57_734);
  assert.equal(calculateAccountLedgerCents("card", 0, [
    { kind: "expense", amountCents: 42_266 },
    { kind: "transfer_in", amountCents: 42_266, status: "removed" },
  ], payments), 0);
});

const bankRow = (id, date, signedCents, extra = {}) => ({
  id, date, signedCents, amountCents: Math.abs(signedCents), description: id,
  kind: signedCents < 0 ? "transfer_out" : "transfer_in", pending: false,
  removedByProvider: false, linkedToApp: false, ...extra,
});

test("payment clues include larger already linked withdrawals without claiming they match", () => {
  const clues = nearbyPaymentBankActivity({ date: "2026-09-09", amountCents: 42_266, signedCents: -42_266 }, [
    bankRow("statement", "2026-09-09", -100_000, { linkedToApp: true }),
    bankRow("exact", "2026-09-12", -42_266),
    bankRow("income", "2026-09-09", 42_266),
    bankRow("old", "2026-09-03", -42_266),
    bankRow("removed", "2026-09-09", -42_266, { removedByProvider: true }),
    bankRow("pending-replaced", "2026-09-09", -42_266, { pending: true }),
  ], new Set(["pending-replaced"]));
  assert.deepEqual(clues.map(item => [item.id, item.exactAmount, item.linkedToApp]), [
    ["exact", true, false], ["statement", false, true],
  ]);
});

test("card-side clues use credits and include the five-day boundary", () => {
  const clues = nearbyPaymentBankActivity({ date: "2026-09-09", amountCents: 42_266, signedCents: 42_266 }, [
    bankRow("credit", "2026-09-04", 42_266),
    bankRow("withdrawal", "2026-09-09", -42_266),
    bankRow("late", "2026-09-15", 42_266),
  ]);
  assert.deepEqual(clues.map(item => item.id), ["credit"]);
});

const duplicateEntry = (id, date, description, signedCents, extra = {}) => ({
  id, date, description, signedCents, kind: "expense", source: "plaid", excluded: false, ...extra,
});

test("different bank IDs with shifted dates are flagged and explain the combined gap", () => {
  const pairs = possibleLedgerDuplicates([
    duplicateEntry("prudential-old", "2026-09-13", "Prudential", -10_500),
    duplicateEntry("prudential-new", "2026-09-14", "Prudential", -10_500),
    duplicateEntry("verizon-old", "2026-09-13", "Verizon", -21_240),
    duplicateEntry("verizon-new", "2026-09-14", "Verizon", -21_240),
  ]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs.reduce((sum, pair) => sum + pair.balanceEffectIfExcludedCents, 0), 31_740);
});

test("excluded duplicates, recurring monthly bills and opposite directions are not flagged", () => {
  assert.deepEqual(possibleLedgerDuplicates([
    duplicateEntry("kept", "2026-09-14", "Prudential", -10_500),
    duplicateEntry("deleted", "2026-09-13", "Prudential", -10_500, { excluded: true }),
    duplicateEntry("previous-month", "2026-08-14", "Prudential", -10_500),
    duplicateEntry("refund", "2026-09-14", "Prudential", 10_500, { kind: "refund" }),
    duplicateEntry("different-merchant", "2026-09-14", "Other bill", -10_500),
  ]), []);
});

test("repeated legitimate charges remain separate even when warned about", () => {
  const entries = [duplicateEntry("one", "2026-09-14", "Coffee", -475), duplicateEntry("two", "2026-09-14", "Coffee", -475)];
  const before = structuredClone(entries);
  assert.equal(possibleLedgerDuplicates(entries).length, 1);
  assert.deepEqual(entries, before);
});

test("unlinked pending-to-posted candidates with changed tips are flagged without merging", () => {
  const entries = [duplicateEntry("hold", "2026-09-01", "Restaurant", -4000, { pending: true }), duplicateEntry("settled", "2026-09-10", "Restaurant", -4800, { pending: false })];
  const before = structuredClone(entries);
  const pairs = possibleLedgerDuplicates(entries);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].balanceEffectIfExcludedCents, 4000);
  assert.deepEqual(entries, before);
  assert.equal(possibleLedgerDuplicates(entries.map(row => ({ ...row, pending: false }))).length, 0);
  assert.equal(possibleLedgerDuplicates([entries[0], { ...entries[1], date: "2026-09-16" }]).length, 0);
});

test("linked records are checked against the final bank amount, not just the old pending identity", () => {
  const entries = [{ id: "purchase", description: "Dinner", signedCents: -4000, pending: true, excluded: false, providerTransactionId: "hold" }];
  const bank = [bankRow("hold", "2026-09-01", -4000, { pending: true, removedByProvider: true }), bankRow("settled", "2026-09-02", -4800)];
  const differences = linkedBankDifferences(entries, bank, new Map([["hold", "settled"]]));
  assert.equal(differences.length, 1);
  assert.equal(differences[0].amountDifferenceCents, -800);
  assert.equal(differences[0].bank.id, "settled");
  assert.equal(differences[0].pendingDiffers, true);
  assert.deepEqual(linkedBankDifferences([{ ...entries[0], signedCents: -4800, pending: false }], bank, new Map([["hold", "settled"]])), []);
  assert.deepEqual(linkedBankDifferences([{ ...entries[0], excluded: true }], bank), []);
});

test("linked card-payment amount mismatches and bank removals remain visible", () => {
  const entry = { id: "payment", description: "Payment", signedCents: -4200, pending: false, excluded: false, providerTransactionId: "withdrawal" };
  assert.equal(linkedBankDifferences([entry], [bankRow("withdrawal", "2026-09-02", -4226)])[0].amountDifferenceCents, -26);
  assert.equal(linkedBankDifferences([entry], [bankRow("withdrawal", "2026-09-02", -4200, { removedByProvider: true })])[0].bank.removedByProvider, true);
});
