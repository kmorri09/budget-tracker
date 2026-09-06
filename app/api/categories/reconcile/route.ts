import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { allocations, auditEvents, categories, transactions } from "../../../../lib/schema";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  balances: z.array(z.object({ id: z.string().min(1), available: z.number().finite() })).min(1).max(500),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid balances" }, { status: 400 });
  const input = parsed.data;
  if (new Set(input.balances.map(item => item.id)).size !== input.balances.length) return NextResponse.json({ error: "Each category can only be reconciled once" }, { status: 400 });
  const db = getDatabase();
  const [ownedCategories, allocationRows, transactionRows] = await Promise.all([
    db.select().from(categories).where(and(eq(categories.userId, user.id), eq(categories.active, true))),
    db.select().from(allocations).where(eq(allocations.userId, user.id)),
    db.select().from(transactions).where(eq(transactions.userId, user.id)),
  ]);
  const categoryById = new Map(ownedCategories.map(category => [category.id, category]));
  if (input.balances.some(item => !categoryById.has(item.id))) return NextResponse.json({ error: "One or more categories were not found" }, { status: 404 });
  const changes = input.balances.flatMap(item => {
    const allocated = allocationRows.filter(row => row.categoryId === item.id).reduce((sum, row) => sum + row.amountCents, 0);
    const spending = transactionRows.filter(row => row.categoryId === item.id && row.kind === "expense").reduce((sum, row) => sum + row.amountCents, 0);
    const refunds = transactionRows.filter(row => row.categoryId === item.id && row.kind === "refund").reduce((sum, row) => sum + row.amountCents, 0);
    const currentCents = allocated - spending + refunds;
    const desiredCents = Math.round(item.available * 100);
    const deltaCents = desiredCents - currentCents;
    return Math.abs(deltaCents) < 1 ? [] : [{ category: categoryById.get(item.id)!, currentCents, desiredCents, deltaCents }];
  });
  await db.transaction(async tx => {
    for (const change of changes) {
      const allocationId = randomUUID();
      await tx.insert(allocations).values({ id: allocationId, userId: user.id, categoryId: change.category.id, amountCents: change.deltaCents, effectiveDate: input.date, note: "Category balance reconciliation" });
      await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "reconcile", entityType: "category", entityId: change.category.id, beforeJson: JSON.stringify({ availableCents: change.currentCents }), afterJson: JSON.stringify({ availableCents: change.desiredCents, deltaCents: change.deltaCents, allocationId, date: input.date }) });
    }
  });
  return NextResponse.json({ ok: true, adjusted: changes.length });
}
