import test from "node:test";
import assert from "node:assert/strict";
import { bankFieldOverrides, bankTransactionUpdate, fetchTransactionUpdates, finalTransactionUpdates } from "../lib/bank-sync-updates.ts";
import { toNormalized } from "../lib/bank-sync-core.ts";

const charge = (id, amount, pending = false, extra = {}) => ({ transaction_id: id, account_id: "remote-card", amount, pending, date: "2026-10-02", merchant_name: "Restaurant", ...extra });
const entry = (extra = {}) => ({ id: "one-purchase", accountId: "card", amountCents: 4000, kind: "expense", categoryId: "dining", effectiveDate: "2026-10-01", description: "Restaurant", status: "pending", pending: true, source: "plaid", providerTransactionId: "hold", ...extra });
const audit = (before, after) => ({ entityId: "one-purchase", beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after) });
const page = (extra = {}) => ({ added: [], modified: [], removed: [], next_cursor: "done", has_more: false, ...extra });

test("categorized restaurant authorization settles with tip on the same purchase identity", () => {
  const initial = entry();
  const overrides = bankFieldOverrides([audit({ ...initial, categoryId: null }, { ...initial, userEdited: true, description: "Dinner with friends" })]).get(initial.id);
  const edited = { ...initial, description: "Dinner with friends" };
  const bank = toNormalized(charge("settled", 48, false, { pending_transaction_id: "hold" }), "credit_card");
  const { changes, conflicts } = bankTransactionUpdate(edited, bank, "card", overrides);
  const settled = { ...edited, ...changes };
  assert.equal(settled.id, initial.id);
  assert.equal(settled.amountCents, 4800);
  assert.equal(settled.providerTransactionId, "settled");
  assert.equal(settled.pending, false);
  assert.equal(settled.status, "posted");
  assert.equal(settled.categoryId, "dining");
  assert.equal(settled.description, "Dinner with friends");
  assert.deepEqual(conflicts, []);
  assert.deepEqual(bankTransactionUpdate(settled, bank, "card", overrides).changes, changes);
});

test("a posted Lyft charge can be modified later to add a tip", () => {
  const initial = entry({ amountCents: 2000, status: "posted", pending: false, providerTransactionId: "ride" });
  const { changes } = bankTransactionUpdate(initial, toNormalized(charge("ride", 25, false, { merchant_name: "Lyft" })), "card");
  assert.equal(changes.amountCents, 2500);
  assert.equal(changes.providerTransactionId, "ride");
  assert.equal(changes.pending, false);
});

test("finalized foreign charges replace preliminary cents in either direction", () => {
  for (const [initialAmount, finalAmount, expectedCents] of [[109.37, 109.41, 10941], [109.37, 109.32, 10932], [109.37, 109.37, 10937]]) {
    const initial = entry({ amountCents: Math.round(initialAmount * 100) });
    const { changes, conflicts } = bankTransactionUpdate(initial, toNormalized(charge("final-fx", finalAmount, false, { pending_transaction_id: "hold" })), "card");
    assert.equal(changes.amountCents, expectedCents);
    assert.equal(changes.pending, false);
    assert.deepEqual(conflicts, []);
  }
});

test("bank-linked manual and Notion purchases retain their description and category while settling", () => {
  for (const source of ["manual", "notion_import"]) {
    const initial = entry({ source, description: "My dinner", effectiveDate: "2026-09-30" });
    const { changes } = bankTransactionUpdate(initial, toNormalized(charge("settled", 48)), "card");
    assert.equal(changes.amountCents, 4800);
    assert.equal(changes.description, "My dinner");
    assert.equal(changes.categoryId, "dining");
    assert.equal(changes.effectiveDate, "2026-09-30");
    assert.equal(changes.pending, false);
  }
});

test("explicit amount overrides stay intact and surface a bank conflict", () => {
  const initial = entry();
  const overrides = bankFieldOverrides([audit(initial, { ...initial, amountCents: 3500 })]).get(initial.id);
  const { changes, conflicts } = bankTransactionUpdate({ ...initial, amountCents: 3500 }, toNormalized(charge("settled", 48)), "card", overrides);
  assert.equal(changes.amountCents, 3500);
  assert.equal(changes.pending, false);
  assert.match(conflicts.join(" "), /35.00 differs from bank amount 48.00/);
});

test("category and status edits do not freeze amount, date or posting status", () => {
  const initial = entry();
  const overrides = bankFieldOverrides([audit(initial, { ...initial, categoryId: "travel", status: "cleared", pending: false, userEdited: true }), { entityId: initial.id, beforeJson: "broken", afterJson: "{}" }]).get(initial.id);
  assert.deepEqual([...overrides], []);
  const { changes } = bankTransactionUpdate({ ...initial, categoryId: "travel", status: "cleared" }, toNormalized(charge("settled", 48)), "card", overrides);
  assert.equal(changes.amountCents, 4800);
  assert.equal(changes.effectiveDate, "2026-10-02");
  assert.equal(changes.status, "cleared");
  assert.equal(changes.categoryId, "travel");
});

test("posted replacement wins even if its old pending row appears later in modified", () => {
  const hold = charge("hold", 40, true);
  const settled = charge("settled", 48, false, { pending_transaction_id: "hold" });
  assert.deepEqual(finalTransactionUpdates([hold, settled], [hold]), [settled]);
  assert.deepEqual(finalTransactionUpdates([settled], [charge("settled", 50, false, { pending_transaction_id: "hold" })]).map(row => row.amount), [50]);
});

test("unrelated same-merchant purchases are preserved even when amounts are close", () => {
  const first = charge("one", 109.37);
  const second = charge("two", 109.41);
  assert.deepEqual(finalTransactionUpdates([first, second], []), [first, second]);
});

test("collects pending replacement and removal across all pages, including beyond twenty", async () => {
  let calls = 0;
  const updates = await fetchTransactionUpdates(async cursor => {
    assert.equal(cursor, calls ? `page-${calls}` : "start");
    calls++;
    return page({ added: calls === 1 ? [charge("hold", 40, true)] : calls === 22 ? [charge("settled", 48, false, { pending_transaction_id: "hold" })] : [], removed: calls === 23 ? [{ transaction_id: "hold" }] : [], next_cursor: `page-${calls}`, has_more: calls < 23 });
  }, "start");
  assert.equal(calls, 23);
  assert.equal(updates.nextCursor, "page-23");
  assert.deepEqual(updates.removed, [{ transaction_id: "hold" }]);
  assert.deepEqual(finalTransactionUpdates(updates.added, updates.modified).map(row => row.transaction_id), ["settled"]);
});

test("pagination mutation restarts at the original cursor and discards partial results", async () => {
  const cursors = [];
  const updates = await fetchTransactionUpdates(async cursor => {
    cursors.push(cursor);
    if (cursors.length === 1) return page({ added: [charge("stale", 1)], next_cursor: "partial", has_more: true });
    if (cursors.length === 2) throw Object.assign(new Error("mutation"), { code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" });
    return page({ added: [charge("current", 48)] });
  }, "original");
  assert.deepEqual(cursors, ["original", "partial", "original"]);
  assert.deepEqual(updates.added.map(row => row.transaction_id), ["current"]);
});

test("incomplete pagination and exhausted mutation retries fail without a partial cursor", async () => {
  await assert.rejects(fetchTransactionUpdates(async () => page({ has_more: true }), "original", { maxPages: 2 }), /No transaction changes or cursor will be saved/);
  let attempts = 0;
  await assert.rejects(fetchTransactionUpdates(async () => { attempts++; throw Object.assign(new Error("mutation"), { code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" }); }, "original"), /mutation/);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(fetchTransactionUpdates(async () => { attempts++; throw new Error("network"); }, "original"), /network/);
  assert.equal(attempts, 1);
});
