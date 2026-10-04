import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "./db";
import { calculateCategoryBalance } from "./category-balance";
import { allocations, auditEvents, categories, transactions } from "./schema";

export class CoverOverspendingError extends Error {
  constructor(message: string, readonly status = 404) { super(message); this.name = "CoverOverspendingError"; }
}

export async function coverCategoryOverspending(db: Database, userId: string, categoryIds: string[], date: string) {
  return db.transaction(async tx => {
    // Serialize covering requests for the same categories before reading balances.
    const selected = await tx.select().from(categories).where(and(
      eq(categories.userId, userId), eq(categories.active, true), inArray(categories.id, categoryIds),
    )).orderBy(asc(categories.id)).for("update");
    if (selected.length !== categoryIds.length) throw new CoverOverspendingError("One or more selected categories are inactive or were not found. Refresh and try again.");
    const [allocationRows, transactionRows] = await Promise.all([
      tx.select().from(allocations).where(and(eq(allocations.userId, userId), inArray(allocations.categoryId, categoryIds))),
      tx.select().from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.categoryId, categoryIds))),
    ]);
    let categoriesFunded = 0, totalCents = 0;
    for (const category of selected) {
      const availableCents = calculateCategoryBalance(category.id, allocationRows, transactionRows).availableCents;
      if (availableCents >= 0) continue;
      const amountCents = -availableCents;
      const allocationId = randomUUID();
      await tx.insert(allocations).values({ id: allocationId, userId, categoryId: category.id, amountCents, effectiveDate: date, note: "Cover overspending" });
      await tx.insert(auditEvents).values({
        id: randomUUID(), userId, action: "cover_overspending", entityType: "category", entityId: category.id,
        beforeJson: JSON.stringify({ availableCents }),
        afterJson: JSON.stringify({ availableCents: 0, amountCents, allocationId, date }),
      });
      categoriesFunded += 1;
      totalCents += amountCents;
    }
    return { categoriesFunded, amount: totalCents / 100 };
  });
}
