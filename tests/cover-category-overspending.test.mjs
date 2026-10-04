import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/schema.ts";
import { coverCategoryOverspending, CoverOverspendingError } from "../lib/cover-category-overspending.ts";
import { calculateCategoryBalance } from "../lib/category-balance.ts";

// These PostgreSQL transactions use an in-memory fixture, never the live database.
const client = new PGlite();
const db = drizzle(client, { schema });
const date = "2026-10-04";
before(async () => client.exec(await readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8")));
after(async () => client.close());
beforeEach(async () => {
  await client.exec('TRUNCATE TABLE "users" CASCADE');
  await db.insert(schema.users).values([
    { id: "user", email: "owner@example.test", passwordHash: "unused", displayName: "Owner" },
    { id: "other", email: "other@example.test", passwordHash: "unused", displayName: "Other" },
  ]);
  await db.insert(schema.accounts).values({ id: "cash", userId: "user", name: "Cash", institution: "Fixture", type: "checking" });
  await db.insert(schema.categories).values([
    { id: "groceries", userId: "user", name: "Groceries" },
    { id: "dining", userId: "user", name: "Dining" },
    { id: "utilities", userId: "user", name: "Utilities" },
    { id: "travel", userId: "user", name: "Travel" },
    { id: "empty", userId: "user", name: "Empty" },
    { id: "inactive", userId: "user", name: "Inactive", active: false },
    { id: "foreign", userId: "other", name: "Private" },
  ]);
  await db.insert(schema.allocations).values([
    { id: "existing-food", userId: "user", categoryId: "groceries", amountCents: 5000, effectiveDate: date },
    { id: "existing-travel", userId: "user", categoryId: "travel", amountCents: 10000, effectiveDate: date },
  ]);
  await db.insert(schema.transactions).values([
    { id: "food", userId: "user", accountId: "cash", categoryId: "groceries", kind: "expense", amountCents: 22501, effectiveDate: date, description: "Groceries" },
    { id: "refund", userId: "user", accountId: "cash", categoryId: "groceries", kind: "refund", amountCents: 1001, effectiveDate: date, description: "Refund" },
    { id: "removed", userId: "user", accountId: "cash", categoryId: "groceries", kind: "expense", amountCents: 999, effectiveDate: date, description: "Removed", status: "removed" },
    { id: "dining", userId: "user", accountId: "cash", categoryId: "dining", kind: "expense", amountCents: 9900, effectiveDate: date, description: "Dining" },
    { id: "utilities", userId: "user", accountId: "cash", categoryId: "utilities", kind: "expense", amountCents: 1798, effectiveDate: date, description: "Utilities" },
  ]);
});

test("covers selected negative balances with individual allocations, preserving other categories and account activity", async () => {
  const beforeTransactions = await db.select().from(schema.transactions);
  assert.deepEqual(await coverCategoryOverspending(db, "user", ["groceries", "dining"], date), { categoriesFunded: 2, amount: 264 });
  const allocations = await db.select().from(schema.allocations);
  const created = allocations.filter(row => row.note === "Cover overspending");
  assert.deepEqual(created.map(row => [row.categoryId, row.amountCents, row.effectiveDate]).sort(), [["dining", 9900, date], ["groceries", 16500, date]]);
  for (const id of ["groceries", "dining"]) assert.equal(calculateCategoryBalance(id, allocations, beforeTransactions).availableCents, 0);
  assert.equal(calculateCategoryBalance("utilities", allocations, beforeTransactions).availableCents, -1798);
  assert.equal(calculateCategoryBalance("travel", allocations, beforeTransactions).availableCents, 10000);
  assert.deepEqual(await db.select().from(schema.transactions), beforeTransactions);
  const audits = await db.select().from(schema.auditEvents);
  assert.equal(audits.length, 2);
  for (const audit of audits) {
    assert.equal(audit.action, "cover_overspending");
    const detail = JSON.parse(audit.afterJson);
    assert.equal(detail.availableCents, 0);
    assert(created.some(row => row.id === detail.allocationId && row.amountCents === detail.amountCents));
  }
});

test("recalculates current balances and skips zero, positive, or previously covered categories", async () => {
  await db.insert(schema.allocations).values({ id: "recent-funding", userId: "user", categoryId: "groceries", amountCents: 16499, effectiveDate: date });
  assert.deepEqual(await coverCategoryOverspending(db, "user", ["groceries", "empty", "travel"], date), { categoriesFunded: 1, amount: 0.01 });
  assert.deepEqual(await coverCategoryOverspending(db, "user", ["groceries", "empty", "travel"], date), { categoriesFunded: 0, amount: 0 });
  assert.equal((await db.select().from(schema.auditEvents)).length, 1);
});

test("an invalid, inactive, or foreign category rejects the batch without any allocations", async () => {
  for (const id of ["missing", "inactive", "foreign"]) {
    await assert.rejects(coverCategoryOverspending(db, "user", ["groceries", id], date), error => error instanceof CoverOverspendingError && error.status === 404);
    assert.equal((await db.select().from(schema.allocations)).length, 2);
    assert.equal((await db.select().from(schema.auditEvents)).length, 0);
  }
});
