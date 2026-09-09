import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { auditEvents, budgetAdjustments } from "../../../../lib/schema";

const updateSchema = z.object({
  id: z.string().min(1),
  amount: z.coerce.number().finite().refine(value => value !== 0, "Amount cannot be zero"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(200),
});
const deleteSchema = z.object({ id: z.string().min(1) });

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid adjustment" }, { status: 400 });
  const input = parsed.data;
  const db = getDatabase();
  const existing = (await db.select().from(budgetAdjustments).where(and(eq(budgetAdjustments.id, input.id), eq(budgetAdjustments.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Adjustment not found" }, { status: 404 });
  const changes = { amountCents: Math.round(input.amount * 100), effectiveDate: input.date, note: input.note };
  await db.transaction(async tx => {
    await tx.update(budgetAdjustments).set(changes).where(and(eq(budgetAdjustments.id, input.id), eq(budgetAdjustments.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "update", entityType: "budget_adjustment", entityId: input.id, beforeJson: JSON.stringify(existing), afterJson: JSON.stringify(changes) });
  });
  return NextResponse.json({ id: input.id, ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Adjustment id is required" }, { status: 400 });
  const db = getDatabase();
  const existing = (await db.select().from(budgetAdjustments).where(and(eq(budgetAdjustments.id, parsed.data.id), eq(budgetAdjustments.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Adjustment not found" }, { status: 404 });
  await db.transaction(async tx => {
    await tx.delete(budgetAdjustments).where(and(eq(budgetAdjustments.id, existing.id), eq(budgetAdjustments.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "delete", entityType: "budget_adjustment", entityId: existing.id, beforeJson: JSON.stringify(existing) });
  });
  return NextResponse.json({ id: existing.id, ok: true });
}
