import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/schema.ts";
import { syncConnection } from "../lib/bank-sync.ts";
import { encryptProviderToken } from "../lib/provider-crypto.ts";
import { calculateAccountLedgerCents } from "../lib/account-ledger.ts";

// Real PostgreSQL queries and transactions, entirely in memory. This suite
// never reads an environment file or connects to DATABASE_URL or Plaid.
const client = new PGlite();
const db = drizzle(client, { schema });
const savedFetch = globalThis.fetch;
const envKeys = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_TOKEN_ENCRYPTION_KEY"];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let pages = [];
const remote = (id, amount, pending = false, extra = {}) => ({ transaction_id: id, account_id: "remote-card", amount, date: "2026-10-02", merchant_name: "Restaurant", pending, ...extra });
const page = (extra = {}) => ({ added: [], modified: [], removed: [], next_cursor: "final-cursor", has_more: false, ...extra });
const sync = async (...batch) => { pages = [...batch]; const result = await syncConnection(db, "user", "connection"); assert.equal(pages.length, 0); return result; };
const ledger = () => db.select().from(schema.transactions);

before(async () => {
  await client.exec(await readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8"));
  process.env.PLAID_CLIENT_ID = "fixture-client";
  process.env.PLAID_SECRET = "fixture-secret";
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = "fixture-only-key-with-enough-entropy";
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.access_token, "fixture-access");
    if (String(url).endsWith("/accounts/get")) return Response.json({ accounts: [{ account_id: "remote-card", name: "Card", type: "credit", balances: { current: 48 } }, { account_id: "remote-cash", name: "Cash", type: "depository", balances: { current: 1000 } }] });
    assert(String(url).endsWith("/transactions/sync"), `Unexpected external request: ${url}`);
    assert.equal(request.count, 500);
    assert(pages.length, "Unexpected extra sync page");
    const next = pages.shift();
    if (next instanceof Error) throw next;
    return Response.json(next);
  };
});

beforeEach(async () => {
  await client.exec('TRUNCATE TABLE "users" CASCADE');
  await db.insert(schema.users).values({ id: "user", email: "fixture@example.test", passwordHash: "unused", displayName: "Fixture" });
  await db.insert(schema.accounts).values([{ id: "card", userId: "user", name: "Card", institution: "Fixture", type: "credit_card" }, { id: "cash", userId: "user", name: "Cash", institution: "Fixture", type: "checking" }]);
  await db.insert(schema.categories).values({ id: "dining", userId: "user", name: "Dining" });
  await db.insert(schema.providerConnections).values({ id: "connection", userId: "user", provider: "plaid", itemId: "fixture-item", accessTokenEncrypted: encryptProviderToken("fixture-access"), createdAt: new Date("2026-10-01T00:00:00Z") });
  await db.insert(schema.providerAccounts).values({ id: "provider-card", userId: "user", connectionId: "connection", providerAccountId: "remote-card", name: "Card", type: "credit_card", localAccountId: "card" });
  await db.insert(schema.providerAccounts).values({ id: "provider-cash", userId: "user", connectionId: "connection", providerAccountId: "remote-cash", name: "Cash", type: "checking", localAccountId: "cash" });
});

after(async () => {
  globalThis.fetch = savedFetch;
  for (const key of envKeys) if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  await client.close();
});

async function edit(initial, changes) {
  await db.update(schema.transactions).set({ ...changes, userEdited: true }).where(eq(schema.transactions.id, initial.id));
  await db.insert(schema.auditEvents).values({ id: `edit-${initial.id}`, userId: "user", action: "update", entityType: "transaction", entityId: initial.id, beforeJson: JSON.stringify(initial), afterJson: JSON.stringify({ ...initial, ...changes }) });
}

test("full sync settles a categorized tipped charge across pages, retains applications, and replays once", async () => {
  const hold = remote("hold", 40, true);
  await sync(page({ added: [hold] }));
  const [initial] = await ledger();
  await edit(initial, { categoryId: "dining", description: "Dinner" });
  await db.insert(schema.cardPayments).values({ id: "payment", userId: "user", fromAccountId: "cash", toAccountId: "card", amountCents: 4000, effectiveDate: "2026-10-02", description: "Paid dinner" });
  await db.insert(schema.cardPaymentApplications).values({ id: "application", userId: "user", paymentId: "payment", transactionId: initial.id, amountCents: 4000 });
  const posted = remote("posted", 48, false, { pending_transaction_id: "hold", date: "2026-10-03" });
  await sync(page({ added: [posted], next_cursor: "split", has_more: true }), page({ modified: [hold], removed: [{ transaction_id: "hold" }] }));
  let rows = await ledger();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, initial.id);
  assert.equal(rows[0].amountCents, 4800);
  assert.equal(rows[0].description, "Dinner");
  assert.equal(rows[0].categoryId, "dining");
  assert.equal(rows[0].pending, false);
  assert.equal(rows[0].status, "posted");
  const applications = await db.select().from(schema.cardPaymentApplications);
  assert.equal(applications[0].transactionId, initial.id);
  assert.equal(rows[0].amountCents - applications[0].amountCents, 800);
  await sync(page({ modified: [posted] }));
  rows = await ledger();
  assert.equal(rows.length, 1);
  assert.equal(calculateAccountLedgerCents("card", 0, rows, await db.select().from(schema.cardPayments)), -800);
  assert.equal((await db.select().from(schema.providerConnections))[0].cursor, "final-cursor");
});

test("same-ID posted Lyft tips and final FX cents update the stored ledger", async () => {
  await sync(page({ added: [remote("lyft", 20, false, { merchant_name: "Lyft" }), remote("foreign", 109.37, true, { merchant_name: "Foreign shop" })] }));
  await sync(page({ modified: [remote("lyft", 25, false, { merchant_name: "Lyft" })], added: [remote("fx-final", 109.41, false, { pending_transaction_id: "foreign", merchant_name: "Foreign shop" })], removed: [{ transaction_id: "foreign" }] }));
  const rows = await ledger();
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.providerTransactionId === "lyft").amountCents, 2500);
  assert.equal(rows.find(row => row.providerTransactionId === "fx-final").amountCents, 10941);
  await sync(page({ modified: [remote("fx-final", 109.32, false, { merchant_name: "Foreign shop" })] }));
  assert.equal((await ledger()).find(row => row.providerTransactionId === "fx-final").amountCents, 10932);
});

test("edits and deletions stay protected after a purchase is moved to an unmapped account", async () => {
  await db.insert(schema.accounts).values({ id: "unmapped", userId: "user", name: "Unmapped", institution: "Fixture", type: "credit_card" });
  await sync(page({ added: [remote("hold", 40, true)] }));
  const [initial] = await ledger();
  await edit(initial, { accountId: "unmapped", amountCents: 3500 });
  await sync(page({ added: [remote("posted", 48, false, { pending_transaction_id: "hold" })], removed: [{ transaction_id: "hold" }] }));
  let [row] = await ledger();
  assert.equal(row.accountId, "unmapped");
  assert.equal(row.amountCents, 3500);
  assert((await db.select().from(schema.reviewItems)).some(item => item.kind === "provider_update_conflict" && /bank account mapping/.test(item.details)));
  await db.update(schema.transactions).set({ status: "removed" }).where(eq(schema.transactions.id, row.id));
  await db.insert(schema.auditEvents).values({ id: "deleted", userId: "user", action: "delete", entityType: "transaction", entityId: row.id });
  await sync(page({ modified: [remote("posted", 49)] }));
  [row] = await ledger();
  assert.equal(row.status, "removed");
  assert.equal(row.amountCents, 3500);
});

test("failed database write rolls back ledger, raw data and cursor; retry creates one row", async () => {
  await client.exec(`CREATE OR REPLACE FUNCTION fixture_fail_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture write failure'; END $$; CREATE TRIGGER fixture_fail_review BEFORE INSERT ON review_items FOR EACH ROW EXECUTE FUNCTION fixture_fail_review()`);
  try {
    await assert.rejects(sync(page({ added: [remote("hold", 40, true)] })));
    assert.equal((await ledger()).length, 0);
    assert.equal((await db.select().from(schema.rawProviderTransactions)).length, 0);
    assert.equal((await db.select().from(schema.providerConnections))[0].cursor, null);
    assert.equal((await db.select().from(schema.syncLocks)).length, 0);
    assert.equal((await db.select().from(schema.syncRuns))[0].status, "failed");
  } finally { await client.exec("DROP TRIGGER fixture_fail_review ON review_items; DROP FUNCTION fixture_fail_review()"); }
  await sync(page({ added: [remote("hold", 40, true)] }));
  assert.equal((await ledger()).length, 1);
});

test("deleted pending purchase stays excluded after posting and a later modification without alias", async () => {
  await sync(page({ added: [remote("hold", 40, true)] }));
  const [initial] = await ledger();
  await db.update(schema.transactions).set({ status: "removed", pending: false }).where(eq(schema.transactions.id, initial.id));
  await db.insert(schema.auditEvents).values({ id: "deleted", userId: "user", action: "delete", entityType: "transaction", entityId: initial.id });
  await sync(page({ added: [remote("posted", 48, false, { pending_transaction_id: "hold" })], removed: [{ transaction_id: "hold" }] }));
  await sync(page({ modified: [remote("posted", 49)] }));
  const rows = await ledger();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "removed");
  assert.equal(rows[0].providerTransactionId, "posted");
  assert.equal(calculateAccountLedgerCents("card", 0, rows, []), 0);
});

test("amount overrides and over-covered finalized purchases create review conflicts", async () => {
  await sync(page({ added: [remote("override", 40), remote("covered", 109.37)] }));
  const rows = await ledger();
  const overridden = rows.find(row => row.providerTransactionId === "override");
  const covered = rows.find(row => row.providerTransactionId === "covered");
  await edit(overridden, { amountCents: 3500 });
  await db.insert(schema.cardCoverageAdjustments).values({ id: "coverage", userId: "user", transactionId: covered.id, amountCents: 10937, effectiveDate: "2026-10-02", note: "Paid" });
  await sync(page({ modified: [remote("override", 48), remote("covered", 109.32)] }));
  assert.equal((await ledger()).find(row => row.id === overridden.id).amountCents, 3500);
  assert.equal((await ledger()).find(row => row.id === covered.id).amountCents, 10932);
  const reviews = (await db.select().from(schema.reviewItems)).filter(row => row.kind === "provider_update_conflict" && row.status === "open");
  assert.equal(reviews.length, 2);
  assert(reviews.some(row => /35.00 differs from bank amount 48.00/.test(row.details)));
  assert(reviews.some(row => /coverage 109.37 exceeds/.test(row.details)));
});

test("missing pending alias plus provider removal does not double-count a linked manual purchase", async () => {
  await db.insert(schema.transactions).values({ id: "manual", userId: "user", accountId: "card", categoryId: "dining", kind: "expense", amountCents: 4000, effectiveDate: "2026-10-02", description: "Dinner", source: "manual" });
  await sync(page({ added: [remote("hold", 40, true)] }));
  assert.equal((await ledger())[0].pending, true);
  await sync(page({ added: [remote("posted-no-alias", 48)], removed: [{ transaction_id: "hold" }] }));
  const rows = await ledger();
  assert.equal(rows.filter(row => row.status !== "removed").length, 1);
  assert.equal(calculateAccountLedgerCents("card", 0, rows, []), -4800);
  assert.equal(rows.find(row => row.id === "manual").status, "removed");
  assert((await db.select().from(schema.reviewItems)).some(row => row.kind === "provider_update_conflict" && /removed this linked manual/.test(row.details)));
});

test("cash-side payment modifications cannot populate the card-side link when pending ID is null", async () => {
  await db.insert(schema.cardPayments).values({ id: "payment", userId: "user", fromAccountId: "cash", toAccountId: "card", amountCents: 4000, effectiveDate: "2026-10-02", description: "Payment" });
  const withdrawal = remote("withdrawal", 40, false, { account_id: "remote-cash", name: "AUTOPAY PAYMENT", merchant_name: null });
  await sync(page({ added: [withdrawal] }));
  await sync(page({ modified: [withdrawal] }));
  const [payment] = await db.select().from(schema.cardPayments);
  assert.equal(payment.providerTransactionId, "withdrawal");
  assert.equal(payment.destinationProviderTransactionId, null);
  assert.equal((await ledger()).length, 0);
});

test("posted identity keeps its pending alias through later modifications and old pending replays", async () => {
  const hold = remote("hold", 40, true);
  await sync(page({ added: [hold] }));
  await sync(page({ added: [remote("posted", 48, false, { pending_transaction_id: "hold" })], removed: [{ transaction_id: "hold" }] }));
  await sync(page({ modified: [remote("posted", 49)] }));
  await sync(page({ modified: [hold] }));
  const rows = await ledger();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountCents, 4900);
  assert.equal(rows[0].pending, false);
  assert.equal((await db.select().from(schema.rawProviderTransactions)).find(row => row.providerTransactionId === "posted").pendingTransactionId, "hold");
});

test("authorization holds removed without a purchase disappear from the balance", async () => {
  await sync(page({ added: [remote("hotel-hold", 200, true, { merchant_name: "Hotel" })] }));
  await sync(page({ removed: [{ transaction_id: "hotel-hold" }] }));
  assert.equal(calculateAccountLedgerCents("card", 0, await ledger(), []), 0);
  assert.equal((await ledger())[0].status, "removed");
});

test("a paid purchase removed without an alias leaves a review to reassign its applications", async () => {
  await sync(page({ added: [remote("hold", 40, true)] }));
  const [initial] = await ledger();
  await db.insert(schema.cardPayments).values({ id: "payment", userId: "user", fromAccountId: "cash", toAccountId: "card", amountCents: 4000, effectiveDate: "2026-10-02", description: "Dinner payment" });
  await db.insert(schema.cardPaymentApplications).values({ id: "application", userId: "user", paymentId: "payment", transactionId: initial.id, amountCents: 4000 });
  await sync(page({ added: [remote("posted-no-alias", 48)], removed: [{ transaction_id: "hold" }] }));
  assert.equal((await ledger()).filter(row => row.status !== "removed").length, 1);
  assert.equal((await db.select().from(schema.cardPaymentApplications))[0].transactionId, initial.id);
  assert((await db.select().from(schema.reviewItems)).some(row => row.kind === "provider_update_conflict" && /applications reassigned/.test(row.details)));
});

test("a removed payment bank leg retains the recorded payment but creates a review", async () => {
  await db.insert(schema.cardPayments).values({ id: "payment", userId: "user", fromAccountId: "cash", toAccountId: "card", amountCents: 4000, effectiveDate: "2026-10-02", description: "Payment" });
  await sync(page({ added: [remote("withdrawal", 40, true, { account_id: "remote-cash", name: "AUTOPAY PAYMENT", merchant_name: null })] }));
  await sync(page({ removed: [{ transaction_id: "withdrawal" }] }));
  const [payment] = await db.select().from(schema.cardPayments);
  assert.equal(payment.amountCents, 4000);
  assert.equal(payment.providerTransactionId, null);
  assert((await db.select().from(schema.reviewItems)).some(row => row.kind === "provider_payment_conflict:payment" && /removed the linked cash withdrawal/.test(row.details)));
});

test("already frozen categorized amounts are repaired from saved bank data without another bank modification", async () => {
  await sync(page({ added: [remote("posted", 48)] }));
  const [initial] = await ledger();
  await edit(initial, { categoryId: "dining" });
  // Simulate the old bug: the finalized raw bank row was saved but the
  // categorized ledger amount was still the authorization amount.
  await db.update(schema.transactions).set({ amountCents: 4000 }).where(eq(schema.transactions.id, initial.id));
  await sync(page());
  const [repaired] = await ledger();
  assert.equal(repaired.amountCents, 4800);
  assert.equal(repaired.categoryId, "dining");
});

test("a linked card payment changing amount is flagged, never inserted as another withdrawal", async () => {
  await db.insert(schema.cardPayments).values({ id: "payment", userId: "user", fromAccountId: "cash", toAccountId: "card", amountCents: 4000, effectiveDate: "2026-10-02", description: "Payment" });
  await sync(page({ added: [remote("credit-hold", -40, true, { name: "AUTOPAY PAYMENT", merchant_name: null })] }));
  await sync(page({ added: [remote("credit-posted", -41, false, { name: "AUTOPAY PAYMENT", merchant_name: null, pending_transaction_id: "credit-hold" })], removed: [{ transaction_id: "credit-hold" }] }));
  assert.equal((await ledger()).length, 0);
  const [payment] = await db.select().from(schema.cardPayments);
  assert.equal(payment.destinationProviderTransactionId, "credit-posted");
  assert.equal(payment.amountCents, 4000);
  assert((await db.select().from(schema.reviewItems)).some(row => row.kind === "provider_payment_conflict:payment"));
});
