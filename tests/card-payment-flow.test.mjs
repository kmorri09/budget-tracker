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
  const originalAllocations = await db.select().from(schema.allocations);
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.activity.find(t => t.id === "full-purchase").remainingToPay, 0);
  assert.equal(workspace.activity.find(t => t.id === "partial-purchase").remainingToPay, 439.20);
  const preview = cardPaymentPreview(workspace, today, "cash");
  assert.equal(preview.suggestedCents, 34080);
  assert.equal(preview.reservedCents, 65920);
  assert.deepEqual(await db.select().from(schema.transactions), original);
  assert.deepEqual(await db.select().from(schema.allocations), originalAllocations);
  const response = await createCardPayment(db, "owner", input(workspace));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const after = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(after.accounts.find(a => a.id === "cash").ledgerBalance, 659.20);
  assert.equal(Math.round(after.activity.find(t => t.id === "partial-purchase").remainingToPay * 100), 9840);
  assert.equal(cardPaymentPreview(after, today, "cash").suggestedCents, 0);
  assert.equal((await db.select().from(schema.auditEvents)).length, 1);
  assert.deepEqual(await db.select().from(schema.allocations), originalAllocations);
});

test("a cash refund and bank cash cannot fund a category with no allocations, and no allocation is created", async () => {
  await db.insert(schema.categories).values({ id: "unallocated", userId: "owner", name: "Unallocated category" });
  await db.insert(schema.transactions).values([
    { id: "cash-refund", userId: "owner", accountId: "cash", categoryId: "unallocated", kind: "refund", description: "Cash refund", amountCents: 10000, effectiveDate: today },
    { id: "unallocated-purchase", userId: "owner", accountId: "card", categoryId: "unallocated", kind: "expense", description: "Purchase", amountCents: 10000, effectiveDate: today },
  ]);
  const originalAllocations = await db.select().from(schema.allocations);
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  const category = workspace.managedCategories.find(c => c.id === "unallocated");
  assert.equal(category.allocated, 0);
  assert.equal(category.available, 0);
  assert(!cardPaymentPreview(workspace, today, "cash").fundedSuggestions.flatMap(s => s.applications).some(a => a.transactionId === "unallocated-purchase"));
  const response = await createCardPayment(db, "owner", input(workspace, { amount: 100, applications: [{ transactionId: "unallocated-purchase", amount: 100 }] }));
  assert.equal(response.status, 409);
  assert.deepEqual(await db.select().from(schema.allocations), originalAllocations);
  assert.equal((await db.select().from(schema.cardPayments)).length, 0);
});

test("future allocations never fund today's or future-dated proposed payments", async () => {
  await db.insert(schema.categories).values({ id: "scheduled", userId: "owner", name: "Scheduled funding" });
  await db.insert(schema.allocations).values([
    { id: "scheduled-current", userId: "owner", categoryId: "scheduled", amountCents: 10000, effectiveDate: today },
    { id: "scheduled-future", userId: "owner", categoryId: "scheduled", amountCents: 10000, effectiveDate: "2099-01-01" },
  ]);
  await db.insert(schema.transactions).values([
    { id: "consumed-funding", userId: "owner", accountId: "cash", categoryId: "scheduled", kind: "expense", description: "Cash expense", amountCents: 10000, effectiveDate: today },
    { id: "needs-funding", userId: "owner", accountId: "card", categoryId: "scheduled", kind: "expense", description: "Card expense", amountCents: 10000, effectiveDate: today },
  ]);
  for (const date of [today, "2099-01-01"]) {
    const workspace = await loadPaymentWorkspace(db, "owner", date);
    const category = workspace.managedCategories.find(c => c.id === "scheduled");
    assert.equal(category.allocated, 100);
    assert.equal(category.available, -100);
    assert(!cardPaymentPreview(workspace, date, "cash").fundedSuggestions.flatMap(s => s.applications).some(a => a.transactionId === "needs-funding"));
  }
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

test("an ambiguous Target refund cannot fund unrelated Fun purchases in either the preview or save command", async () => {
  await db.insert(schema.categories).values({ id: "fun", userId: "owner", name: "Fun (Steph)" });
  await db.insert(schema.transactions).values([
    { id: "target-a", userId: "owner", accountId: "card", categoryId: "fun", kind: "expense", description: "Target", amountCents: 6000, effectiveDate: "2026-09-20" },
    { id: "target-b", userId: "owner", accountId: "card", categoryId: "fun", kind: "expense", description: "Target", amountCents: 6989, effectiveDate: "2026-10-18" },
    { id: "target-refund", userId: "owner", accountId: "card", categoryId: "fun", kind: "refund", description: "Target", amountCents: 4545, effectiveDate: "2026-10-20" },
    { id: "home-depot", userId: "owner", accountId: "card", categoryId: "fun", kind: "expense", description: "The Home Depot", amountCents: 292, effectiveDate: "2026-09-19" },
  ]);
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.managedCategories.find(c => c.id === "fun").unmatchedRefunds, 45.45);
  assert.equal(workspace.activity.find(t => t.id === "home-depot").remainingToPay, 2.92);
  assert(!cardPaymentPreview(workspace, today, "cash").fundedSuggestions.flatMap(s => s.applications).some(a => a.category === "Fun (Steph)"));
  const response = await createCardPayment(db, "owner", input(workspace, { amount: 2.92, applications: [{ transactionId: "home-depot", amount: 2.92 }] }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /category funding/);
  assert.equal((await db.select().from(schema.cardPayments)).length, 0);
});
