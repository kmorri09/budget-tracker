import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { calculateCategoryBalance } from "../../../../lib/category-balance";
import { getDatabase } from "../../../../lib/db";
import { calculateObligationFunding } from "../../../../lib/obligation-funding";
import { allocations, auditEvents, categories, obligations, transactions } from "../../../../lib/schema";

const schema = z.object({
  obligationIds: z.array(z.string().min(1)).min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid obligations" }, { status: 400 });
  const ids = [...new Set(parsed.data.obligationIds)];
  if (ids.length !== parsed.data.obligationIds.length) return NextResponse.json({ error: "Each obligation can only be selected once" }, { status: 400 });
  const db = getDatabase();
  const [obligationRows, categoryRows, allocationRows, transactionRows] = await Promise.all([
    db.select().from(obligations).where(and(eq(obligations.userId, user.id), eq(obligations.active, true))),
    db.select().from(categories).where(and(eq(categories.userId, user.id), eq(categories.active, true))),
    db.select().from(allocations).where(eq(allocations.userId, user.id)),
    db.select().from(transactions).where(eq(transactions.userId, user.id)),
  ]);
  const selected = obligationRows.filter(obligation => ids.includes(obligation.id));
  if (selected.length !== ids.length) return NextResponse.json({ error: "One or more obligations were not found" }, { status: 404 });
  const categoryBalances = categoryRows.map(category => ({ id: category.id, name: category.name, availableCents: calculateCategoryBalance(category.id, allocationRows, transactionRows).availableCents }));
  const funding = calculateObligationFunding(selected.map(obligation => ({ id: obligation.id, categoryId: obligation.categoryId, name: obligation.name, amountCents: obligation.amountCents })), categoryBalances);
  const changes = funding.filter(group => group.allocationCents > 0);

  await db.transaction(async tx => {
    for (const group of changes) {
      await tx.insert(allocations).values({ id: randomUUID(), userId: user.id, categoryId: group.categoryId, amountCents: group.allocationCents, effectiveDate: parsed.data.date, note: `Fund upcoming obligations: ${group.obligationNames.join(", ")}` });
    }
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "fund", entityType: "upcoming_obligations", entityId: randomUUID(), afterJson: JSON.stringify({ date: parsed.data.date, obligationIds: ids, funding: changes }) });
  });
  return NextResponse.json({ ok: true, categoriesFunded: changes.length, amount: changes.reduce((sum, group) => sum + group.allocationCents, 0) / 100 });
}
