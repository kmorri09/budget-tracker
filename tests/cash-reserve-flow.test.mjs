import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/schema.ts";
import { budgetToday } from "../lib/budget-date.ts";
import { loadPaymentWorkspace } from "../lib/payment-workspace.ts";
import { cardPaymentPreview } from "../lib/card-payment-suggestions.ts";
import { fundObligations } from "../lib/fund-obligations-command.ts";

const client = new PGlite(), db = drizzle(client, { schema }), today = budgetToday();
before(async () => {
  await client.exec(await readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8"));
  await db.insert(schema.users).values({ id: "owner", email: "owner@example.invalid", passwordHash: "unused", displayName: "Owner" });
  await db.insert(schema.accounts).values([
    { id: "cash", userId: "owner", name: "Cash", institution: "Fixture", type: "checking", openingBalanceCents: 20000 },
    { id: "card", userId: "owner", name: "Card", institution: "Fixture", type: "credit_card" },
  ]);
  await db.insert(schema.categories).values({ id: "insurance", userId: "owner", name: "Insurance" });
  await db.insert(schema.allocations).values({ id: "fund", userId: "owner", categoryId: "insurance", amountCents: 20000, effectiveDate: today });
  await db.insert(schema.transactions).values({ id: "purchase", userId: "owner", categoryId: "insurance", accountId: "card", kind: "expense", amountCents: 10000, effectiveDate: today, description: "Card charge", createdAt: new Date("2026-01-01T00:00:00Z") });
  await db.insert(schema.cashReserveAdjustments).values({ id: "reserve", userId: "owner", categoryId: "insurance", amountCents: 10000, effectiveDate: today, createdAt: new Date("2026-01-01T00:00:01Z") });
});
after(async () => client.close());

test("reserve replays pending, posted, edited and removed cash expenses once", async () => {
  let workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.managedCategories[0].cashReserve, 100);
  assert.equal(cardPaymentPreview(workspace, today, "cash").fundedCents, 10000);
  await db.insert(schema.transactions).values({ id: "cash-expense", userId: "owner", categoryId: "insurance", accountId: "cash", kind: "expense", amountCents: 3000, effectiveDate: today, description: "Cash bill", pending: true, status: "pending", createdAt: new Date("2026-01-01T00:00:02Z") });
  workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.managedCategories[0].cashReserve, 70);
  await db.update(schema.transactions).set({ pending: false, status: "posted", amountCents: 3500 }).where(eq(schema.transactions.id, "cash-expense"));
  workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.managedCategories[0].cashReserve, 65);
  await db.update(schema.transactions).set({ status: "removed" }).where(eq(schema.transactions.id, "cash-expense"));
  workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.managedCategories[0].cashReserve, 100);
  await db.update(schema.allocations).set({ amountCents: 5000 }).where(eq(schema.allocations.id, "fund"));
  workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.managedCategories[0].cashReserve, 50);
  assert.equal(workspace.managedCategories[0].cashReserveShortfall, 50);
});

test("funding protects existing category money, allocates only the rest, and rejects a stale preview", async () => {
  await db.insert(schema.categories).values({ id: "utilities", userId: "owner", name: "Utilities" });
  await db.insert(schema.allocations).values({ id: "utilities-fund", userId: "owner", categoryId: "utilities", amountCents: 5000, effectiveDate: today });
  await db.insert(schema.transactions).values({ id: "income", userId: "owner", accountId: "cash", kind: "income", amountCents: 20000, effectiveDate: today, description: "Pay" });
  await db.insert(schema.obligations).values({ id: "bill", userId: "owner", accountId: "cash", categoryId: "utilities", name: "Internet", amountCents: 12000, dueDate: today, cadence: "Monthly" });
  const input = { obligations: [{ id: "bill", amountCents: 12000 }], date: today, expectedAllocationCents: 7000 };
  const response = await fundObligations(db, "owner", input);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(), { ok: true, categoriesFunded: 1, amount: 70 });
  const reserveRows = (await db.select().from(schema.cashReserveAdjustments)).filter(row => row.categoryId === "utilities");
  assert.equal(reserveRows.length, 1);
  assert.equal(reserveRows[0].amountCents, 12000);
  const repeat = await fundObligations(db, "owner", input);
  assert.equal(repeat.status, 409);
  assert.equal((await db.select().from(schema.cashReserveAdjustments)).filter(row => row.categoryId === "utilities").length, 1);
  const refreshed = await fundObligations(db, "owner", { ...input, expectedAllocationCents: 0 });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).categoriesFunded, 0);
});

test("future income and unmatched card refunds cannot fund a cash reserve today", async () => {
  const next = new Date(`${today}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  await db.insert(schema.categories).values({ id: "other-bill", userId: "owner", name: "Other bill" });
  await db.insert(schema.obligations).values({ id: "future-bill", userId: "owner", accountId: "cash", categoryId: "other-bill", name: "Other bill", amountCents: 6000, dueDate: today });
  await db.insert(schema.transactions).values([
    { id: "future-income", userId: "owner", accountId: "cash", kind: "income", amountCents: 10000, effectiveDate: next.toISOString().slice(0, 10), description: "Future pay" },
    { id: "unmatched-credit", userId: "owner", accountId: "card", categoryId: "other-bill", kind: "refund", amountCents: 6000, effectiveDate: today, description: "Unmatched credit" },
  ]);
  const workspace = await loadPaymentWorkspace(db, "owner", today);
  assert.equal(workspace.managedCategories.find(c => c.id === "other-bill").unmatchedRefunds, 60);
  const result = await fundObligations(db, "owner", { obligations: [{ id: "future-bill", amountCents: 6000 }], date: today, expectedAllocationCents: 6000 });
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /current Ready to Allocate/);
  assert.equal((await db.select().from(schema.cashReserveAdjustments)).filter(r => r.categoryId === "other-bill").length, 0);
});
