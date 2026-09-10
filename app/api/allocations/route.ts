import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { allocations, auditEvents, categories } from "../../../lib/schema";
import { allocationUpdateSchema, idSchema } from "../../../lib/api-validation";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = allocationUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid allocation" }, { status: 400 });
  const input = parsed.data;
  const db = getDatabase();
  const [existing, category] = await Promise.all([
    db.select().from(allocations).where(and(eq(allocations.id, input.id), eq(allocations.userId, user.id))).limit(1),
    db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.userId, user.id))).limit(1),
  ]);
  if (!existing.length) return NextResponse.json({ error: "Allocation not found" }, { status: 404 });
  if (!category.length) return NextResponse.json({ error: "Category not found" }, { status: 400 });
  const changes = { amountCents: Math.round(input.amount * 100), effectiveDate: input.date, categoryId: input.categoryId, note: input.note || null };
  await db.transaction(async tx => {
    await tx.update(allocations).set(changes).where(and(eq(allocations.id, input.id), eq(allocations.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "update", entityType: "allocation", entityId: input.id, beforeJson: JSON.stringify(existing[0]), afterJson: JSON.stringify(changes) });
  });
  return NextResponse.json({ id: input.id, ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = idSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Allocation id is required" }, { status: 400 });
  const db = getDatabase();
  const existing = (await db.select().from(allocations).where(and(eq(allocations.id, parsed.data.id), eq(allocations.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Allocation not found" }, { status: 404 });
  await db.transaction(async tx => {
    await tx.delete(allocations).where(and(eq(allocations.id, existing.id), eq(allocations.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "delete", entityType: "allocation", entityId: existing.id, beforeJson: JSON.stringify(existing) });
  });
  return NextResponse.json({ id: existing.id, ok: true });
}
