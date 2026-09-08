import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { calculateAvailableToAssignCents } from "../../../../lib/budget-balance";
import { getDatabase } from "../../../../lib/db";
import { allocations, auditEvents, budgetAdjustments, transactions } from "../../../../lib/schema";

const schema = z.object({
  desiredBalance: z.number().finite(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid reconciliation" }, { status: 400 });
  const db = getDatabase();
  const [transactionRows, allocationRows, adjustmentRows] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.userId, user.id)),
    db.select().from(allocations).where(eq(allocations.userId, user.id)),
    db.select().from(budgetAdjustments).where(eq(budgetAdjustments.userId, user.id)),
  ]);
  const current = calculateAvailableToAssignCents(transactionRows, allocationRows, adjustmentRows);
  const desiredCents = Math.round(parsed.data.desiredBalance * 100);
  const deltaCents = desiredCents - current.availableCents;
  if (Math.abs(deltaCents) < 1) return NextResponse.json({ ok: true, delta: 0 });

  const id = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(budgetAdjustments).values({ id, userId: user.id, amountCents: deltaCents, effectiveDate: parsed.data.date, note: parsed.data.note });
    await tx.insert(auditEvents).values({
      id: randomUUID(), userId: user.id, action: "reconcile", entityType: "available_to_assign", entityId: id,
      beforeJson: JSON.stringify({ availableCents: current.availableCents }),
      afterJson: JSON.stringify({ availableCents: desiredCents, deltaCents, date: parsed.data.date, note: parsed.data.note }),
    });
  });
  return NextResponse.json({ ok: true, delta: deltaCents / 100 });
}
