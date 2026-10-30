import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/schema.ts";
import { loadPaymentWorkspace } from "../lib/payment-workspace.ts";
import { createCardPayment, updateCardPayment } from "../lib/card-payment-commands.ts";
import { cardPaymentPreview } from "../lib/card-payment-suggestions.ts";
import { budgetToday } from "../lib/budget-date.ts";
import { saveCardRefundMatch } from "../lib/card-refund-commands.ts";

// Complete PostgreSQL schema and real command transactions, entirely in memory.
const client = new PGlite(), db = drizzle(client, { schema }), today = budgetToday();
before(async () => client.exec(await readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8")));
after(async () => client.close());
beforeEach(async () => {
  await client.exec('TRUNCATE TABLE users CASCADE');
  await db.insert(schema.users).values([{ id: "owner", email: "owner@test.invalid", passwordHash: "unused", displayName: "Owner" }, { id: "other", email: "other@test.invalid", passwordHash: "unused", displayName: "Other" }]);
  await db.insert(schema.accounts).values([{ id: "cash", userId: "owner", name: "Cash", institution: "Fixture", type: "savings", openingBalanceCents: 100000 }, { id: "card", userId: "owner", name: "Card", institution: "Fixture", type: "credit_card" }, { id: "foreign", userId: "other", name: "Other cash", institution: "Fixture", type: "savings" }]);
  await db.insert(schema.categories).values([{ id: "travel", userId: "owner", name: "Travel" }, { id: "rent", userId: "owner", name: "Rent" }]);
  await db.insert(schema.allocations).values([{ id: "fund", userId: "owner", categoryId: "travel", amountCents: 69840, effectiveDate: "2026-09-01" }, { id: "rent-fund", userId: "owner", categoryId: "rent", amountCents: 40000, effectiveDate: "2026-09-01" }]);
  await db.insert(schema.transactions).values([
    { id: "full-purchase", userId: "owner", accountId: "card", categoryId: "travel", description: "American Airlines", amountCents: 14001, kind: "expense", effectiveDate: "2026-09-18" },
    { id: "partial-purchase", userId: "owner", accountId: "card", categoryId: "travel", description: "American Airlines", amountCents: 55839, kind: "expense", effectiveDate: "2026-09-18" },
    { id: "full-refund", userId: "owner", accountId: "card", categoryId: "travel", description: "American Airlines", amountCents: 14001, kind: "refund", effectiveDate: "2026-10-08" },
    { id: "partial-refund", userId: "owner", accountId: "card", categoryId: "travel", description: "American Airlines", amountCents: 11919, kind: "refund", effectiveDate: "2026-10-08" },
  ]);
});
const input = (workspace, extra = {}) => ({ fromAccountId: "cash", toAccountId: "card", amount: 340.80, date: today, description: "Reviewed payment", alreadyMade: false, reviewToken: workspace.paymentReviewToken, applications: [{ transactionId: "partial-purchase", amount: 340.80 }], ...extra });

test("existing refunds produce $0 and $439.20 remaining; a saved suggestion preserves all reserves", async () => {
  const original = await db.select().from(schema.transactions);
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.activity.find(t => t.id === "full-purchase").remainingToPay, 0);
  assert.equal(workspace.activity.find(t => t.id === "partial-purchase").remainingToPay, 439.20);
  const preview = cardPaymentPreview(workspace, today, "cash");
  assert.equal(preview.suggestedCents, 34080);
  assert.equal(preview.reservedCents, 65920);
  assert.deepEqual(await db.select().from(schema.transactions), original);
  const response = await createCardPayment(db, "owner", input(workspace));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const after = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(after.accounts.find(a => a.id === "cash").ledgerBalance, 659.20);
  assert.equal(Math.round(after.activity.find(t => t.id === "partial-purchase").remainingToPay * 100), 9840);
  assert.equal(cardPaymentPreview(after, today, "cash").suggestedCents, 0);
  assert.equal((await db.select().from(schema.auditEvents)).length, 1);
});

test("changed allocations or an intervening payment reject a stale preview without writes", async () => {
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  await db.insert(schema.allocations).values({ id: "changed", userId: "owner", categoryId: "rent", amountCents: 1, effectiveDate: today });
  const response = await createCardPayment(db, "owner", input(workspace));
  assert.equal(response.status, 409);
  assert.equal((await db.select().from(schema.cardPayments)).length, 0);
  assert.equal((await db.select().from(schema.auditEvents)).length, 0);
});

test("server rejects unaffordable payments, fully refunded selections, duplicate selections and foreign accounts", async () => {
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal((await createCardPayment(db, "owner", input(workspace, { amount: 400 }))).status, 409);
  assert.equal((await createCardPayment(db, "owner", input(workspace, { amount: 140.01, applications: [{ transactionId: "full-purchase", amount: 140.01 }] }))).status, 400);
  assert.equal((await createCardPayment(db, "owner", input(workspace, { amount: 20, applications: [{ transactionId: "partial-purchase", amount: 10 }, { transactionId: "partial-purchase", amount: 10 }] }))).status, 400);
  assert.equal((await createCardPayment(db, "owner", input(workspace, { fromAccountId: "foreign" }))).status, 400);
  assert.equal((await db.select().from(schema.cardPayments)).length, 0);
});

test("recording a payment that already happened remains possible and refunds still constrain applications", async () => {
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  const response = await createCardPayment(db, "owner", input(workspace, { amount: 439.20, applications: [{ transactionId: "partial-purchase", amount: 439.20 }], alreadyMade: true }));
  assert.equal(response.status, 200);
  const payment = (await db.select().from(schema.cardPayments))[0];
  const reviewed = await loadPaymentWorkspace(db, "owner", today);
  const invalid = await updateCardPayment(db, "owner", { ...input(reviewed), id: payment.id, alreadyMade: true, amount: 450, applications: [{ transactionId: "partial-purchase", amount: 450 }] });
  assert.equal(invalid.status, 400);
  assert.equal((await db.select().from(schema.cardPayments))[0].amountCents, 43920);
});

test("future income never increases today's payment cash and schema migration is repeatable", async () => {
  const previous = await loadPaymentWorkspace(db, "owner", today);
  await db.insert(schema.transactions).values({ id: "future-income", userId: "owner", accountId: "cash", description: "Future income", amountCents: 999999, kind: "income", effectiveDate: "2099-01-01" });
  const current = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(current.accounts.find(a => a.id === "cash").ledgerBalance, previous.accounts.find(a => a.id === "cash").ledgerBalance);
  assert.notEqual(current.paymentReviewToken, previous.paymentReviewToken);
  await client.exec(await readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8"));
  assert.equal((await db.select().from(schema.transactions)).length, 5);
});

test("refund review validates ownership and capacity, audits decisions, and invalidates the payment preview", async () => {
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  const decision = { refundId: "full-refund", transactionId: "full-purchase", amount: 140.01, status: "dismissed" };
  assert.equal((await saveCardRefundMatch(db, "other", decision)).status, 400);
  assert.equal((await db.select().from(schema.cardRefundMatches)).length, 0);
  assert.equal((await saveCardRefundMatch(db, "owner", decision)).status, 200);
  assert.equal((await db.select().from(schema.auditEvents))[0].entityType, "card_refund_match");
  const updated = await loadPaymentWorkspace(db, "owner", today);
  assert.notEqual(updated.paymentReviewToken, workspace.paymentReviewToken);
  assert(!updated.cardCoverage.refunds.links.some(l => l.refundId === "full-refund" && l.transactionId === "full-purchase"));
  assert.equal((await saveCardRefundMatch(db, "owner", { ...decision, amount: 140.02, status: "confirmed" })).status, 409);
  assert.equal((await saveCardRefundMatch(db, "owner", { ...decision, status: "confirmed" })).status, 200);
  assert.equal((await loadPaymentWorkspace(db, "owner", today)).activity.find(t => t.id === "full-purchase").paymentStatus, "Refunded");
});
